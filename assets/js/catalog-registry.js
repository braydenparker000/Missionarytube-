/**
 * Astra catalog registry.
 *
 * Add-ons are allowed to publish identical catalog names, catalog ids and
 * media ids. This module gives every provider/catalog occurrence a stable,
 * privacy-safe key and reconciles the viewer's Home layout preferences with
 * the manifests that are available today.
 *
 * Loaded as a classic browser script and through node:vm in the tests.
 */
(function (global) {
  "use strict";

  var VERSION = 1;
  var MAX_CATALOGS = 240;
  var MAX_LABEL = 80;

  function text(value, limit) {
    return value == null ? "" : String(value).slice(0, limit || MAX_LABEL);
  }

  // FNV-1a is not used for security. It turns a configured add-on URL into a
  // deterministic opaque namespace without copying private URL tokens into
  // DOM attributes or layout preference keys.
  function hash(value) {
    var input = String(value || "");
    var out = 2166136261;
    var second = 2246822519;
    for (var i = 0; i < input.length; i += 1) {
      out ^= input.charCodeAt(i);
      out = Math.imul(out, 16777619);
      second ^= input.charCodeAt(i);
      second = Math.imul(second, 3266489917);
    }
    return (out >>> 0).toString(36) + (second >>> 0).toString(36);
  }

  function providerKey(source) {
    var url = source && source.addon && source.addon.url;
    var manifestId = source && source.manifest && source.manifest.id;
    return "p1:" + hash(url) + ":" + hash(manifestId);
  }

  function catalogKey(source, catalog) {
    return "c1:" + providerKey(source) + ":" + hash(
      String(catalog && catalog.type || "") + "\n" +
      String(catalog && catalog.id || "")
    );
  }

  function contentKey(meta) {
    if (!meta || meta.id == null) return "";
    return String(meta.type || "movie") + ":" + String(meta.id);
  }

  function mediaRef(meta) {
    var content = contentKey(meta);
    if (!content) return "";
    var provider = text(meta._providerKey, 100);
    return provider ? "m1:" + provider + ":" + content : content;
  }

  function isAdult(source, catalog) {
    return !!(catalog && catalog.adult) || !!(
      source && source.manifest && source.manifest.behaviorHints &&
      source.manifest.behaviorHints.adult
    );
  }

  function build(sources, options) {
    var includeAdult = !!(options && options.includeAdult);
    var entries = [];
    (Array.isArray(sources) ? sources : []).forEach(function (source) {
      var catalogs = source && source.manifest && source.manifest.catalogs;
      (Array.isArray(catalogs) ? catalogs : []).forEach(function (catalog) {
        if (entries.length >= MAX_CATALOGS) return;
        if (!includeAdult && isAdult(source, catalog)) return;
        entries.push({
          key: catalogKey(source, catalog),
          providerKey: providerKey(source),
          providerName: text(source.manifest.name || source.manifest.id || "Add-on"),
          name: text(catalog.name || catalog.id || "Catalog"),
          type: text(catalog.type || "other", 80),
          source: source,
          catalog: catalog
        });
      });
    });
    return entries;
  }

  function defaults() {
    return {
      version: VERSION,
      showHero: true,
      showProvider: true,
      showType: true,
      order: [],
      catalogs: {}
    };
  }

  function preference(value) {
    var item = value && typeof value === "object" ? value : {};
    return {
      visible: item.visible !== false,
      hero: !!item.hero,
      label: text(item.label)
    };
  }

  function reconcile(entries, raw) {
    var input = raw && typeof raw === "object" ? raw : {};
    var byKey = new Map((Array.isArray(entries) ? entries : []).map(function (entry) {
      return [entry.key, entry];
    }));
    var order = [];
    (Array.isArray(input.order) ? input.order : []).forEach(function (key) {
      key = text(key, 180);
      if (byKey.has(key) && order.indexOf(key) < 0) order.push(key);
    });
    byKey.forEach(function (_, key) {
      if (order.indexOf(key) < 0) order.push(key);
    });

    var catalogs = {};
    order.forEach(function (key) {
      catalogs[key] = preference(input.catalogs && input.catalogs[key]);
    });
    if (!order.some(function (key) { return catalogs[key].hero; })) {
      order.slice(0, 2).forEach(function (key) { catalogs[key].hero = true; });
    }

    return {
      version: VERSION,
      showHero: input.showHero !== false,
      showProvider: input.showProvider !== false,
      showType: input.showType !== false,
      order: order,
      catalogs: catalogs
    };
  }

  function ordered(entries, layout, visibleOnly) {
    var byKey = new Map((entries || []).map(function (entry) { return [entry.key, entry]; }));
    return (layout && layout.order || []).map(function (key) {
      var entry = byKey.get(key);
      if (!entry) return null;
      var pref = preference(layout.catalogs && layout.catalogs[key]);
      return Object.assign({}, entry, pref, {
        displayName: pref.label || entry.name
      });
    }).filter(function (entry) {
      return entry && (!visibleOnly || entry.visible);
    });
  }

  function setCatalog(layout, key, patch) {
    var next = {
      version: VERSION,
      showHero: layout.showHero !== false,
      showProvider: layout.showProvider !== false,
      showType: layout.showType !== false,
      order: (layout.order || []).slice(),
      catalogs: Object.assign({}, layout.catalogs || {})
    };
    if (!next.catalogs[key]) return next;
    next.catalogs[key] = Object.assign({}, preference(next.catalogs[key]), patch || {});
    next.catalogs[key].label = text(next.catalogs[key].label);
    return next;
  }

  function move(layout, key, delta) {
    var next = Object.assign({}, layout, { order: (layout.order || []).slice() });
    var from = next.order.indexOf(key);
    var to = Math.max(0, Math.min(next.order.length - 1, from + Number(delta || 0)));
    if (from < 0 || from === to) return next;
    next.order.splice(from, 1);
    next.order.splice(to, 0, key);
    return next;
  }

  global.AstraCatalogs = {
    VERSION: VERSION,
    hash: hash,
    providerKey: providerKey,
    catalogKey: catalogKey,
    contentKey: contentKey,
    mediaRef: mediaRef,
    build: build,
    defaults: defaults,
    reconcile: reconcile,
    ordered: ordered,
    setCatalog: setCatalog,
    move: move
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
