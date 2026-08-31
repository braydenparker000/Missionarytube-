/**
 * Astra discovery and add-on health primitives.
 *
 * The browser UI owns network requests and rendering. This module keeps the
 * two pieces that need deterministic behaviour outside that surface:
 * privacy-safe health records, and fair random selection across add-ons.
 */
(function (global) {
  "use strict";

  var VERSION = 1;
  var SLOW_MS = 3500;
  var MAX_PROVIDERS = 48;
  var entropy = (Date.now() ^ 0x9e3779b9) >>> 0;

  function text(value, limit) {
    return value == null ? "" : String(value).slice(0, limit || 120);
  }

  // Two small FNV-style accumulators make configured manifest URLs stable
  // identifiers without ever copying their private path or token into health
  // storage, DOM attributes, screenshots, or exported diagnostics.
  function hash(value) {
    var input = String(value || "");
    var a = 2166136261;
    var b = 2246822519;
    for (var i = 0; i < input.length; i += 1) {
      a ^= input.charCodeAt(i);
      a = Math.imul(a, 16777619);
      b ^= input.charCodeAt(i);
      b = Math.imul(b, 3266489917);
    }
    return (a >>> 0).toString(36) + (b >>> 0).toString(36);
  }

  function providerKey(addon) {
    return "h1:" + hash(addon && addon.url);
  }

  function sanitizeError(value) {
    if (value == null || value === "") return "";
    return text(value && value.message || value, 260)
      .replace(/(?:https?|stremio):\/\/[^\s)\]}>,]+/gi, "[address hidden]")
      .replace(/[A-Za-z0-9_-]{28,}={0,2}/g, "[private value]")
      .slice(0, 160);
  }

  function emptyHealth() {
    return { version: VERSION, providers: {} };
  }

  function normalizeHealth(raw) {
    var source = raw && typeof raw === "object" ? raw : {};
    var providers = source.providers && typeof source.providers === "object"
      ? source.providers
      : {};
    var out = emptyHealth();
    Object.keys(providers).slice(-MAX_PROVIDERS).forEach(function (key) {
      if (!/^h1:[a-z0-9]+$/i.test(key)) return;
      var item = providers[key];
      if (!item || typeof item !== "object") return;
      out.providers[key] = {
        key: key,
        name: text(item.name || "Add-on", 80),
        lastCheck: Number(item.lastCheck) || 0,
        lastSuccess: Number(item.lastSuccess) || 0,
        lastFailure: Number(item.lastFailure) || 0,
        lastResult: item.lastResult === "ok" || item.lastResult === "error" ? item.lastResult : "",
        lastLatencyMs: Math.max(0, Math.round(Number(item.lastLatencyMs) || 0)),
        latencyMs: Math.max(0, Math.round(Number(item.latencyMs) || 0)),
        requests: Math.max(0, Math.round(Number(item.requests) || 0)),
        successes: Math.max(0, Math.round(Number(item.successes) || 0)),
        failures: Math.max(0, Math.round(Number(item.failures) || 0)),
        error: sanitizeError(item.error || ""),
        channels: normalizeChannels(item.channels)
      };
    });
    return out;
  }

  function normalizeChannels(raw) {
    var out = {};
    var source = raw && typeof raw === "object" ? raw : {};
    Object.keys(source).slice(0, 12).forEach(function (kind) {
      var item = source[kind];
      if (!item || typeof item !== "object") return;
      out[text(kind, 24)] = {
        ok: item.ok === true,
        checkedAt: Number(item.checkedAt) || 0,
        latencyMs: Math.max(0, Math.round(Number(item.latencyMs) || 0)),
        error: sanitizeError(item.error || "")
      };
    });
    return out;
  }

  function recordHealth(raw, event) {
    var state = normalizeHealth(raw);
    var key = text(event && event.key, 80);
    if (!/^h1:[a-z0-9]+$/i.test(key)) return state;
    var now = Number(event.at) || Date.now();
    var latency = Math.max(0, Math.round(Number(event.latencyMs) || 0));
    var current = state.providers[key] || {
      key: key,
      name: "Add-on",
      lastCheck: 0,
      lastSuccess: 0,
      lastFailure: 0,
      lastResult: "",
      lastLatencyMs: 0,
      latencyMs: 0,
      requests: 0,
      successes: 0,
      failures: 0,
      error: "",
      channels: {}
    };
    var ok = event.ok === true;
    var next = Object.assign({}, current, {
      name: text(event.name || current.name || "Add-on", 80),
      lastCheck: now,
      latencyMs: current.latencyMs
        ? Math.round(current.latencyMs * 0.65 + latency * 0.35)
        : latency,
      requests: Math.min(99999, current.requests + 1),
      successes: Math.min(99999, current.successes + (ok ? 1 : 0)),
      failures: Math.min(99999, current.failures + (ok ? 0 : 1)),
      lastSuccess: ok ? now : current.lastSuccess,
      lastFailure: ok ? current.lastFailure : now,
      lastResult: ok ? "ok" : "error",
      lastLatencyMs: latency,
      error: ok ? "" : sanitizeError(event.error),
      channels: Object.assign({}, current.channels)
    });
    var kind = text(event.kind || "request", 24);
    next.channels[kind] = {
      ok: ok,
      checkedAt: now,
      latencyMs: latency,
      error: ok ? "" : sanitizeError(event.error)
    };
    state.providers[key] = next;
    var keys = Object.keys(state.providers);
    if (keys.length > MAX_PROVIDERS) {
      keys.sort(function (a, b) {
        return state.providers[a].lastCheck - state.providers[b].lastCheck;
      }).slice(0, keys.length - MAX_PROVIDERS).forEach(function (oldKey) {
        delete state.providers[oldKey];
      });
    }
    return state;
  }

  function statusOf(record) {
    if (!record || !record.lastCheck) return "unknown";
    if (record.lastResult === "error" || (!record.lastResult && record.lastFailure > record.lastSuccess)) {
      return record.lastSuccess ? "trouble" : "offline";
    }
    return Math.max(record.lastLatencyMs || 0, record.latencyMs || 0) >= SLOW_MS ? "slow" : "ready";
  }

  function healthSummary(raw, addons) {
    var state = normalizeHealth(raw);
    var counts = { ready: 0, slow: 0, trouble: 0, offline: 0, unknown: 0, disabled: 0 };
    (Array.isArray(addons) ? addons : []).forEach(function (addon) {
      if (addon && addon.enabled === false) {
        counts.disabled += 1;
        return;
      }
      counts[statusOf(state.providers[providerKey(addon)])] += 1;
    });
    return counts;
  }

  function randomUnit() {
    var crypto = global.crypto;
    if (crypto && typeof crypto.getRandomValues === "function") {
      var values = new Uint32Array(1);
      crypto.getRandomValues(values);
      return values[0] / 4294967296;
    }
    // A no-dependency fallback for older embedded browsers. This is selection,
    // not security; xorshift only prevents every fallback session matching.
    entropy ^= entropy << 13;
    entropy ^= entropy >>> 17;
    entropy ^= entropy << 5;
    return (entropy >>> 0) / 4294967296;
  }

  function shuffle(input, random) {
    var list = (Array.isArray(input) ? input : []).slice();
    var rng = typeof random === "function" ? random : randomUnit;
    for (var i = list.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.max(0, Math.min(0.999999999, rng())) * (i + 1));
      var value = list[i];
      list[i] = list[j];
      list[j] = value;
    }
    return list;
  }

  function balancedSources(input, limit, random) {
    var groups = {};
    (Array.isArray(input) ? input : []).forEach(function (entry) {
      var key = text(entry && (entry.providerKey || entry.entry && entry.entry.providerKey), 120) || "unknown";
      if (!groups[key]) groups[key] = [];
      groups[key].push(entry);
    });
    var queues = shuffle(Object.keys(groups), random).map(function (key) {
      return shuffle(groups[key], random);
    });
    var out = [];
    var maximum = Math.max(0, Number(limit) || 0);
    while (queues.length && out.length < maximum) {
      for (var i = queues.length - 1; i >= 0 && out.length < maximum; i -= 1) {
        var next = queues[i].shift();
        if (next) out.push(next);
        if (!queues[i].length) queues.splice(i, 1);
      }
    }
    return out;
  }

  function contentKey(item) {
    if (!item || item.id == null) return "";
    return String(item.type || "movie").toLowerCase() + ":" + String(item.id);
  }

  function isReleased(item, now) {
    var date = item && item.released ? Date.parse(item.released) : NaN;
    if (Number.isFinite(date)) return date <= (Number(now) || Date.now());
    var raw = item && (item.year || item.releaseInfo);
    var match = String(raw || "").match(/\b(19|20)\d{2}\b/);
    if (!match) return true;
    return Number(match[0]) <= new Date(Number(now) || Date.now()).getUTCFullYear();
  }

  function matchesGenre(item, genre) {
    var wanted = text(genre).trim().toLowerCase();
    if (!wanted || wanted === "all") return true;
    var genres = item && Array.isArray(item.genres) ? item.genres : [];
    return genres.some(function (value) {
      return text(value).trim().toLowerCase() === wanted;
    });
  }

  function pick(input, count, options) {
    var config = options || {};
    var seen = new Set(Array.isArray(config.seen) ? config.seen.map(String) : []);
    var known = {};
    var pool = (Array.isArray(input) ? input : []).filter(function (item) {
      var key = contentKey(item);
      if (!key || known[key] || seen.has(key)) return false;
      if (!isReleased(item, config.now)) return false;
      if (!matchesGenre(item, config.genre)) return false;
      known[key] = true;
      return true;
    });
    var withArt = pool.filter(function (item) {
      return !!(item.poster || item.background || item.logo);
    });
    if (withArt.length >= Math.min(Number(count) || 1, pool.length)) pool = withArt;
    return shuffle(pool, config.random).slice(0, Math.max(1, Number(count) || 1));
  }

  global.AstraDiscovery = {
    VERSION: VERSION,
    SLOW_MS: SLOW_MS,
    hash: hash,
    providerKey: providerKey,
    sanitizeError: sanitizeError,
    emptyHealth: emptyHealth,
    normalizeHealth: normalizeHealth,
    recordHealth: recordHealth,
    statusOf: statusOf,
    healthSummary: healthSummary,
    shuffle: shuffle,
    balancedSources: balancedSources,
    contentKey: contentKey,
    isReleased: isReleased,
    matchesGenre: matchesGenre,
    pick: pick
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
