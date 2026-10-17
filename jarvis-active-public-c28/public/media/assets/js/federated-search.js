/**
 * Pure helpers for Astra's progressive, source-aware search surface.
 *
 * Network requests and DOM updates stay in index.html. These functions own
 * identity, provider grouping, local matching and stable result order so the
 * behavior can be verified without a browser or a real add-on.
 */
(function (global) {
  "use strict";

  function text(value) {
    return value == null ? "" : String(value);
  }

  function query(value) {
    return text(value).trim().replace(/\s+/g, " ").toLocaleLowerCase();
  }

  function titleOf(item) {
    return text(item && (item.name || item.title)).trim();
  }

  function contentKey(item) {
    if (!item || item.id == null) return "";
    return text(item.type || "movie").toLocaleLowerCase() + ":" + text(item.id);
  }

  /** Lower numbers are stronger matches; provider order remains the tiebreak. */
  function matchRank(item, rawQuery) {
    var wanted = query(rawQuery);
    var title = titleOf(item).toLocaleLowerCase();
    if (!wanted || !title) return 9;
    if (title === wanted) return 0;
    if (title.indexOf(wanted) === 0) return 1;
    if (title.split(/[^\p{L}\p{N}]+/u).some(function (word) { return word.indexOf(wanted) === 0; })) return 2;
    if (title.indexOf(wanted) !== -1) return 3;
    return 9;
  }

  function merge(existing, incoming, rawQuery) {
    var seen = {};
    var indexed = [];
    (Array.isArray(existing) ? existing : []).concat(Array.isArray(incoming) ? incoming : []).forEach(function (item) {
      var key = contentKey(item);
      if (!key || seen[key]) return;
      seen[key] = true;
      indexed.push({ item: item, index: indexed.length, rank: matchRank(item, rawQuery) });
    });
    indexed.sort(function (a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.index - b.index;
    });
    return indexed.map(function (entry) { return entry.item; });
  }

  function localMatches(input, rawQuery, limit) {
    var wanted = query(rawQuery);
    if (!wanted) return [];
    var matching = (Array.isArray(input) ? input : []).filter(function (item) {
      return matchRank(item, wanted) < 9;
    });
    return merge([], matching, wanted).slice(0, Math.max(1, Number(limit) || 80));
  }

  /** Keep every provider distinct even when its catalogs share the same name. */
  function groupSources(input) {
    var groups = [];
    var byKey = {};
    (Array.isArray(input) ? input : []).forEach(function (source) {
      var entry = source && source.entry;
      var key = text(entry && entry.providerKey);
      if (!key) return;
      if (!byKey[key]) {
        byKey[key] = {
          key: key,
          name: text(entry.providerName || source.s && source.s.manifest && source.s.manifest.name || "Add-on"),
          addon: source.s && source.s.addon || null,
          catalogs: []
        };
        groups.push(byKey[key]);
      }
      byKey[key].catalogs.push(source);
    });
    return groups;
  }

  function types(input) {
    var found = {};
    var out = [];
    (Array.isArray(input) ? input : []).forEach(function (item) {
      var type = text(item && item.type).toLocaleLowerCase();
      if (!type || found[type]) return;
      found[type] = true;
      out.push(type);
    });
    return out;
  }

  function filterType(input, type) {
    var wanted = text(type).toLocaleLowerCase();
    if (!wanted || wanted === "all") return (Array.isArray(input) ? input : []).slice();
    return (Array.isArray(input) ? input : []).filter(function (item) {
      return text(item && item.type).toLocaleLowerCase() === wanted;
    });
  }

  global.AstraSearch = {
    query: query,
    titleOf: titleOf,
    contentKey: contentKey,
    matchRank: matchRank,
    merge: merge,
    localMatches: localMatches,
    groupSources: groupSources,
    types: types,
    filterType: filterType
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
