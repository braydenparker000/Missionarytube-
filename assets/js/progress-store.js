/**
 * Astra playback progress store.
 *
 * Progress records used to embed a complete series metadata object (including
 * the full `videos` array) in every episode entry, and the whole map was
 * re-serialized synchronously every few seconds. That grew without bound and
 * hit localStorage quotas on Android Chrome.
 *
 * This module keeps two normalized maps instead:
 *
 *   entries : mediaKey|videoId -> { time, duration, completed, updated, ... }
 *   metas   : mediaKey         -> compact poster-card metadata, stored once
 *
 * Writes are coalesced, the entry list is bounded, and quota failures degrade
 * to in-memory progress rather than throwing out of a `timeupdate` handler.
 *
 * Loaded as a classic script in the browser (`window.AstraProgress`) and via
 * `node:vm` in the test suite, so it must stay dependency free.
 */
(function (global) {
  "use strict";

  var STORAGE_VERSION = 2;
  var MAX_ENTRIES = 240;
  var MIN_ENTRIES = 20;
  var FLUSH_DELAY_MS = 10000;
  var MAX_TEXT = 200;
  var MAX_URL = 512;
  var MIN_RESUME_SECONDS = 20;
  var COMPLETE_RATIO = 0.93;

  function text(value, limit) {
    if (value == null) return "";
    return String(value).slice(0, limit || MAX_TEXT);
  }

  /**
   * Identity values (media id, media type, video id) are never truncated: they
   * are what `mediaKeyOf` and the entry keys are built from, and a shortened
   * copy would no longer resolve back to the record it names.
   */
  function identity(value) {
    return value == null ? "" : String(value);
  }

  function finite(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function mediaKeyOf(meta) {
    if (!meta || meta.id == null) return "";
    return (meta.type || "movie") + ":" + meta.id;
  }

  function entryKeyOf(mediaKey, videoId) {
    return mediaKey + "|" + videoId;
  }

  function yearOf(meta) {
    if (!meta) return "";
    if (meta.releaseInfo) return text(meta.releaseInfo, 24);
    if (meta.year) return text(meta.year, 24);
    if (meta.released) return text(meta.released, 24).slice(0, 4);
    return "";
  }

  /**
   * Reduce an add-on metadata object to the handful of fields the Continue
   * Watching rail actually renders. Deliberately drops `videos`, `cast`,
   * `description`, trailers and every other unbounded field.
   */
  function compactMeta(meta) {
    if (!meta || meta.id == null) return null;
    var compact = {
      id: identity(meta.id),
      type: identity(meta.type || "movie"),
      name: text(meta.name || meta.title, MAX_TEXT)
    };
    var poster = text(meta.poster, MAX_URL);
    var background = text(meta.background, MAX_URL);
    var releaseInfo = yearOf(meta);
    var addonName = text(meta._addonName, MAX_TEXT);
    var addonUrl = text(meta._addonUrl, MAX_URL);
    if (poster) compact.poster = poster;
    if (background) compact.background = background;
    if (releaseInfo) compact.releaseInfo = releaseInfo;
    if (addonName) compact._addonName = addonName;
    if (addonUrl) compact._addonUrl = addonUrl;
    return compact;
  }

  function isQuotaError(error) {
    if (!error) return false;
    if (error.name === "QuotaExceededError") return true;
    if (error.name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
    return error.code === 22 || error.code === 1014;
  }

  function newestFirst(a, b) {
    return finite(b.updated) - finite(a.updated);
  }

  /**
   * Accepts the current shape, the legacy shape (a flat map of fat records
   * that each carried a full `meta`), and anything unparseable.
   */
  function normalize(raw) {
    var state = { entries: {}, metas: {} };
    var data = raw;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (error) {
        return state;
      }
    }
    if (!data || typeof data !== "object") return state;

    var source = data.v === STORAGE_VERSION && data.entries ? data.entries : data;
    var metas = data.v === STORAGE_VERSION && data.metas ? data.metas : {};

    Object.keys(metas).forEach(function (key) {
      var compact = compactMeta(metas[key]);
      if (compact) state.metas[key] = compact;
    });

    Object.keys(source).forEach(function (key) {
      var record = source[key];
      if (!record || typeof record !== "object") return;
      var mediaKey = identity(record.mediaKey || mediaKeyOf(record.meta));
      var videoId = identity(record.videoId);
      if (!mediaKey || !videoId) return;
      var duration = finite(record.duration);
      if (duration <= 0) return;
      state.entries[entryKeyOf(mediaKey, videoId)] = {
        key: entryKeyOf(mediaKey, videoId),
        mediaKey: mediaKey,
        videoId: videoId,
        time: Math.max(0, Math.min(finite(record.time), duration)),
        duration: duration,
        completed: !!record.completed,
        updated: finite(record.updated)
      };
      // Legacy records carried the whole metadata object; keep one copy.
      if (record.meta && !state.metas[mediaKey]) {
        var compact = compactMeta(record.meta);
        if (compact) state.metas[mediaKey] = compact;
      }
    });

    return state;
  }

  function createProgressStore(options) {
    var opts = options || {};
    var storage = opts.storage || null;
    var storageKey = opts.storageKey || "astra.v1.progress";
    var now = opts.now || function () { return Date.now(); };
    var schedule = opts.schedule || function (fn, ms) { return setTimeout(fn, ms); };
    var cancel = opts.cancel || function (handle) { clearTimeout(handle); };
    var maxEntries = opts.maxEntries || MAX_ENTRIES;
    var flushDelay = opts.flushDelay == null ? FLUSH_DELAY_MS : opts.flushDelay;
    var onError = opts.onError || function () {};

    var entries = {};
    var metas = {};
    var pending = null;
    var writes = 0;
    var pruned = 0;
    var degraded = false;
    var disabled = false;

    function read() {
      if (!storage) return null;
      try {
        return storage.getItem(storageKey);
      } catch (error) {
        disabled = true;
        return null;
      }
    }

    function adopt(state) {
      entries = state.entries;
      metas = state.metas;
    }

    function sortedEntries() {
      return Object.keys(entries)
        .map(function (key) { return entries[key]; })
        .sort(newestFirst);
    }

    /** Keep the newest `limit` entries and drop metadata nothing references. */
    function prune(limit) {
      var ordered = sortedEntries();
      if (ordered.length > limit) {
        ordered.slice(limit).forEach(function (entry) {
          delete entries[entry.key];
          pruned += 1;
        });
      }
      var referenced = {};
      Object.keys(entries).forEach(function (key) {
        referenced[entries[key].mediaKey] = true;
      });
      Object.keys(metas).forEach(function (key) {
        if (!referenced[key]) delete metas[key];
      });
    }

    function snapshot() {
      return { v: STORAGE_VERSION, entries: entries, metas: metas };
    }

    function serialize() {
      return JSON.stringify(snapshot());
    }

    function cancelPending() {
      if (pending == null) return;
      cancel(pending);
      pending = null;
    }

    /**
     * Persist synchronously. On a quota failure the history is halved and the
     * write retried; if it still fails, progress stays in memory for the rest
     * of the session instead of throwing into the caller's event handler.
     */
    function flush() {
      cancelPending();
      if (!storage || disabled) return false;
      prune(maxEntries);
      var limit = maxEntries;
      for (;;) {
        try {
          storage.setItem(storageKey, serialize());
          writes += 1;
          degraded = false;
          return true;
        } catch (error) {
          if (!isQuotaError(error)) {
            disabled = true;
            degraded = true;
            onError(error);
            return false;
          }
          if (limit <= MIN_ENTRIES) {
            degraded = true;
            onError(error);
            return false;
          }
          limit = Math.max(MIN_ENTRIES, Math.floor(limit / 2));
          prune(limit);
        }
      }
    }

    function scheduleFlush() {
      if (!storage || disabled || pending != null) return;
      if (flushDelay <= 0) {
        flush();
        return;
      }
      pending = schedule(function () {
        pending = null;
        flush();
      }, flushDelay);
    }

    function load() {
      adopt(normalize(read()));
      return api;
    }

    /**
     * Record playback position. `immediate` forces a synchronous write for
     * events worth never losing (an episode finishing, leaving the page).
     */
    function record(meta, video, progress) {
      var mediaKey = mediaKeyOf(meta);
      var videoId = identity(video && video.id != null ? video.id : meta && meta.id);
      var duration = finite(progress && progress.duration);
      if (!mediaKey || !videoId || duration <= 0) return null;

      var completed = !!(progress && progress.completed);
      var time = Math.max(0, Math.min(finite(progress && progress.time), duration));
      var entry = {
        key: entryKeyOf(mediaKey, videoId),
        mediaKey: mediaKey,
        videoId: videoId,
        time: completed ? duration : time,
        duration: duration,
        completed: completed,
        updated: now()
      };
      entries[entry.key] = entry;

      var compact = compactMeta(meta);
      if (compact) metas[mediaKey] = compact;

      if (progress && progress.immediate) flush();
      else scheduleFlush();
      return entry;
    }

    function get(mediaKey, videoId) {
      return entries[entryKeyOf(mediaKey, identity(videoId))] || null;
    }

    function entriesFor(mediaKey) {
      return sortedEntries().filter(function (entry) {
        return entry.mediaKey === mediaKey;
      });
    }

    function latest(mediaKey) {
      return entriesFor(mediaKey)[0] || null;
    }

    function meta(mediaKey) {
      return metas[mediaKey] || null;
    }

    /** Compact metadata for the Continue Watching rail, newest first. */
    function continueList() {
      var seen = {};
      return sortedEntries()
        .filter(function (entry) {
          if (entry.completed || !entry.duration) return false;
          if (entry.time <= MIN_RESUME_SECONDS) return false;
          return entry.time / entry.duration < COMPLETE_RATIO;
        })
        .map(function (entry) { return metas[entry.mediaKey]; })
        .filter(function (item) {
          if (!item) return false;
          var key = mediaKeyOf(item);
          if (seen[key]) return false;
          seen[key] = true;
          return true;
        });
    }

    function replace(data) {
      adopt(normalize(data));
      flush();
      return api;
    }

    function clear() {
      entries = {};
      metas = {};
      flush();
      return api;
    }

    function stats() {
      return {
        entries: Object.keys(entries).length,
        metas: Object.keys(metas).length,
        bytes: serialize().length,
        writes: writes,
        pruned: pruned,
        degraded: degraded,
        disabled: disabled
      };
    }

    var api = {
      load: load,
      record: record,
      get: get,
      entriesFor: entriesFor,
      latest: latest,
      meta: meta,
      continueList: continueList,
      flush: flush,
      snapshot: snapshot,
      replace: replace,
      clear: clear,
      stats: stats
    };
    return api;
  }

  global.AstraProgress = {
    STORAGE_VERSION: STORAGE_VERSION,
    MAX_ENTRIES: MAX_ENTRIES,
    MIN_ENTRIES: MIN_ENTRIES,
    FLUSH_DELAY_MS: FLUSH_DELAY_MS,
    compactMeta: compactMeta,
    mediaKeyOf: mediaKeyOf,
    normalize: normalize,
    createProgressStore: createProgressStore
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
