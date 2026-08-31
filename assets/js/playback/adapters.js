/**
 * Astra player adapters and resource scopes.
 *
 * One contract covers native media, HLS and DASH:
 *
 *   { kind, attach(): Promise<void>, destroy(): void, getAudioTracks(), selectAudioTrack(id) }
 *
 * Every adapter owns a ResourceScope. Cleanup is idempotent and releases
 * listeners, timers, object URLs and the underlying library instance, so
 * opening and closing the player repeatedly cannot accumulate state.
 *
 * The media element and the Hls/dashjs constructors are injected, so the whole
 * lifecycle is exercised in Node tests with doubles.
 */
(function (global) {
  "use strict";

  /**
   * Tracks everything a playback attempt allocates. `dispose()` is safe to call
   * any number of times and never throws, even if an individual release fails.
   */
  function createResourceScope(options) {
    var config = options || {};
    var clearTimer = config.clearTimeout || function (handle) { clearTimeout(handle); };
    var revokeUrl =
      config.revokeObjectURL ||
      function (url) {
        if (global.URL && typeof global.URL.revokeObjectURL === "function") global.URL.revokeObjectURL(url);
      };

    var listeners = [];
    var timers = [];
    var urls = [];
    var callbacks = [];
    var disposed = false;

    function listen(target, type, handler, opts) {
      if (disposed || !target || typeof target.addEventListener !== "function") return function () {};
      target.addEventListener(type, handler, opts);
      var record = { target: target, type: type, handler: handler, options: opts, released: false };
      listeners.push(record);
      return function () {
        release(record);
      };
    }

    function release(record) {
      if (record.released) return;
      record.released = true;
      try {
        record.target.removeEventListener(record.type, record.handler, record.options);
      } catch (error) {
        /* a detached node can already be gone; nothing left to release */
      }
    }

    function timer(handle) {
      if (disposed) {
        clearTimer(handle);
        return handle;
      }
      timers.push(handle);
      return handle;
    }

    function objectUrl(url) {
      if (!url) return url;
      if (disposed) {
        revokeUrl(url);
        return url;
      }
      urls.push(url);
      return url;
    }

    function onDispose(callback) {
      if (typeof callback !== "function") return;
      if (disposed) {
        runSafely(callback);
        return;
      }
      callbacks.push(callback);
    }

    function runSafely(fn) {
      try {
        fn();
      } catch (error) {
        /* cleanup must never throw into the caller */
      }
    }

    function dispose() {
      if (disposed) return false;
      disposed = true;
      listeners.forEach(release);
      timers.forEach(function (handle) {
        runSafely(function () {
          clearTimer(handle);
        });
      });
      urls.forEach(function (url) {
        runSafely(function () {
          revokeUrl(url);
        });
      });
      callbacks.forEach(runSafely);
      listeners = [];
      timers = [];
      callbacks = [];
      return true;
    }

    return {
      listen: listen,
      timer: timer,
      objectUrl: objectUrl,
      onDispose: onDispose,
      dispose: dispose,
      get disposed() {
        return disposed;
      },
      stats: function () {
        return {
          listeners: listeners.filter(function (record) {
            return !record.released;
          }).length,
          timers: timers.length,
          objectUrls: urls.length,
          disposed: disposed
        };
      },
      // Exposed for assertions: every URL handed out, released or not.
      trackedUrls: function () {
        return urls.slice();
      }
    };
  }

  var FATAL_HLS_TYPES = { networkError: "network", mediaError: "decode", otherError: "unknown" };

  function baseAdapter(kind, media, scope, handlers) {
    var destroyed = false;
    var events = handlers || {};

    function emitError(type, detail) {
      if (destroyed) return;
      if (typeof events.onError === "function") events.onError({ type: type, detail: detail || "" });
    }

    function emitReady() {
      if (destroyed) return;
      if (typeof events.onReady === "function") events.onReady();
    }

    function emitAudioTracksChanged(tracks) {
      if (destroyed) return;
      if (typeof events.onAudioTracksChanged === "function") events.onAudioTracksChanged(tracks || []);
    }

    // Media element errors are shared by every adapter.
    scope.listen(media, "error", function () {
      var code = media.error && media.error.code;
      var type =
        code === 2 ? "network" : code === 3 ? "decode" : code === 4 ? "unsupported" : "unknown";
      emitError(type, (media.error && media.error.message) || "");
    });
    scope.listen(media, "loadedmetadata", emitReady);

    return {
      kind: kind,
      media: media,
      scope: scope,
      emitError: emitError,
      emitReady: emitReady,
      emitAudioTracksChanged: emitAudioTracksChanged,
      get destroyed() {
        return destroyed;
      },
      markDestroyed: function () {
        if (destroyed) return false;
        destroyed = true;
        return true;
      }
    };
  }

  /** Detach a media element fully so it stops fetching and holds no source. */
  function detachMedia(media) {
    try {
      if (typeof media.pause === "function") media.pause();
    } catch (error) {
      /* pausing a torn-down element can throw; ignore */
    }
    try {
      media.removeAttribute("src");
      media.src = "";
      if (typeof media.load === "function") media.load();
    } catch (error) {
      /* nothing further to release */
    }
  }

  function createNativeAdapter(config) {
    var media = config.media;
    var scope = config.scope || createResourceScope();
    var base = baseAdapter("native", media, scope, config);
    var trackEventsBound = false;

    // Chrome does not expose AudioTrackList for every direct container. When it
    // does, use the real browser tracks; when it does not, return an empty list
    // so the UI can explain the limitation instead of inventing a selector.
    function audioTracks() {
      var nativeTracks = media && media.audioTracks;
      if (!nativeTracks || typeof nativeTracks.length !== "number") return [];
      var list = [];
      for (var index = 0; index < nativeTracks.length; index += 1) {
        var track = nativeTracks[index];
        list.push({
          id: String(index),
          label: trackLabel(track, index),
          lang: trackLanguage(track),
          active: track && track.enabled === true,
          native: true
        });
      }
      return list;
    }

    function announceTracks() {
      base.emitAudioTracksChanged(audioTracks());
    }

    function bindTrackEvents() {
      if (trackEventsBound) return;
      var nativeTracks = media && media.audioTracks;
      if (!nativeTracks || typeof nativeTracks.addEventListener !== "function") return;
      trackEventsBound = true;
      ["addtrack", "removetrack", "change"].forEach(function (event) {
        scope.listen(nativeTracks, event, announceTracks);
      });
    }

    return {
      kind: base.kind,
      scope: scope,
      attach: function () {
        return Promise.resolve().then(function () {
          media.src = config.url;
          bindTrackEvents();
          scope.listen(media, "loadedmetadata", function () {
            bindTrackEvents();
            announceTracks();
          });
          if (typeof media.play === "function") {
            var started = media.play();
            if (started && typeof started.catch === "function") {
              // Autoplay rejection is not a playback failure: the controls stay
              // usable and the viewer can start it themselves.
              started.catch(function () {});
            }
          }
          announceTracks();
        });
      },
      getAudioTracks: function () {
        return audioTracks();
      },
      selectAudioTrack: function (id) {
        var nativeTracks = media && media.audioTracks;
        var index = Number(id);
        if (!nativeTracks || !Number.isInteger(index) || index < 0 || index >= nativeTracks.length) return false;
        try {
          for (var cursor = 0; cursor < nativeTracks.length; cursor += 1) nativeTracks[cursor].enabled = cursor === index;
          announceTracks();
          return nativeTracks[index].enabled === true;
        } catch (error) {
          return false;
        }
      },
      destroy: function () {
        if (!base.markDestroyed()) return;
        scope.dispose();
        detachMedia(media);
      }
    };
  }

  function trackLanguage(track) {
    var value = String((track && (track.lang || track.language || (track.attrs && track.attrs.LANGUAGE))) || "").toLowerCase();
    var aliases = { eng: "en", jpn: "ja", spa: "es", fra: "fr", fre: "fr", deu: "de", ger: "de", por: "pt", ita: "it", kor: "ko", zho: "zh", chi: "zh" };
    var parts = value.split("-");
    if (aliases[parts[0]]) parts[0] = aliases[parts[0]];
    return parts.join("-");
  }

  function trackLabel(track, index) {
    var language = trackLanguage(track);
    var named = track && (track.name || track.label || (track.labels && track.labels[0] && track.labels[0].text));
    var languageNames = { en: "english", es: "spanish", fr: "french", de: "german", pt: "portuguese", it: "italian", ja: "japanese", ko: "korean", zh: "chinese" };
    var details = [];
    var codec = track && (track.codec || track.audioCodec);
    var channels = track && (track.channels || track.audioChannelConfiguration);
    if (Array.isArray(channels)) channels = channels[0] && (channels[0].value || channels[0]);
    if (named) details.push(String(named));
    var languageKey = language.toLowerCase().split("-")[0];
    var namedLanguage = named && String(named).toLowerCase();
    if (language && (!named || (namedLanguage !== language.toLowerCase() && namedLanguage !== languageNames[languageKey]))) details.push(language.toUpperCase());
    if (codec) details.push(String(codec));
    if (channels) details.push(String(channels));
    return details.join(" · ") || "Audio " + (index + 1);
  }

  function createHlsAdapter(config) {
    var media = config.media;
    var scope = config.scope || createResourceScope();
    var base = baseAdapter("hls", media, scope, config);
    var Hls = config.Hls;
    var instance = null;
    var api;

    function audioTracks() {
      if (!instance || !Array.isArray(instance.audioTracks)) return [];
      return instance.audioTracks.map(function (track, index) {
        return {
          id: index,
          label: trackLabel(track, index),
          lang: trackLanguage(track),
          active: instance.audioTrack === index
        };
      });
    }

    function announceTracks() {
      base.emitAudioTracksChanged(audioTracks());
    }

    api = {
      kind: base.kind,
      scope: scope,
      attach: function () {
        return Promise.resolve().then(function () {
          if (!Hls || (typeof Hls.isSupported === "function" && !Hls.isSupported())) {
            var error = new Error("hls.js is not supported in this browser");
            error.playbackType = "library";
            throw error;
          }
          instance = new Hls({ enableWorker: true, lowLatencyMode: true });
          var errorEvent = (Hls.Events && Hls.Events.ERROR) || "hlsError";
          instance.on(errorEvent, function (_event, data) {
            if (!data || !data.fatal) return;
            base.emitError(FATAL_HLS_TYPES[data.type] || "unknown", data.details || "");
          });
          var events = (Hls && Hls.Events) || {};
          var trackEvents = [events.MANIFEST_PARSED || "manifestParsed", events.AUDIO_TRACKS_UPDATED || "audioTracksUpdated", events.AUDIO_TRACK_SWITCHED || "audioTrackSwitched"];
          trackEvents.filter(function (event, index) { return event && trackEvents.indexOf(event) === index; }).forEach(function (event) {
            instance.on(event, announceTracks);
          });
          instance.loadSource(config.url);
          instance.attachMedia(media);
          announceTracks();
        });
      },
      getAudioTracks: function () {
        return audioTracks();
      },
      selectAudioTrack: function (id) {
        if (!instance || !Array.isArray(instance.audioTracks)) return false;
        var index = Number(id);
        if (!Number.isInteger(index) || index < 0 || index >= instance.audioTracks.length) return false;
        instance.audioTrack = index;
        announceTracks();
        return true;
      },
      destroy: function () {
        if (!base.markDestroyed()) return;
        scope.dispose();
        if (instance) {
          try {
            if (typeof instance.off === "function") instance.off();
            if (typeof instance.destroy === "function") instance.destroy();
          } catch (error) {
            /* the library may already have torn itself down */
          }
          instance = null;
        }
        detachMedia(media);
      }
    };
    return api;
  }

  function createDashAdapter(config) {
    var media = config.media;
    var scope = config.scope || createResourceScope();
    var base = baseAdapter("dash", media, scope, config);
    var dashjs = config.dashjs;
    var player = null;
    var errorHandler = null;
    var trackHandlers = [];
    var api;

    function audioTracks() {
      if (!player || typeof player.getTracksFor !== "function") return [];
      var tracks;
      try {
        tracks = player.getTracksFor("audio") || [];
      } catch (error) {
        return [];
      }
      var current = null;
      try {
        current = typeof player.getCurrentTrackFor === "function" ? player.getCurrentTrackFor("audio") : null;
      } catch (error) {
        current = null;
      }
      return tracks.map(function (track, index) {
        return {
          id: index,
          label: trackLabel(track, index),
          lang: trackLanguage(track),
          active: !!current && (current === track || current.index === track.index),
          track: track
        };
      });
    }

    function announceTracks() {
      base.emitAudioTracksChanged(audioTracks());
    }

    api = {
      kind: base.kind,
      scope: scope,
      attach: function () {
        return Promise.resolve().then(function () {
          if (!dashjs || typeof dashjs.MediaPlayer !== "function") {
            var error = new Error("dash.js is unavailable");
            error.playbackType = "library";
            throw error;
          }
          player = dashjs.MediaPlayer().create();
          errorHandler = function (event) {
            var detail = (event && (event.error && (event.error.message || event.error.code))) || "";
            var type = String(detail).toLowerCase().indexOf("manifest") !== -1 ? "manifest" : "decode";
            base.emitError(type, String(detail));
          };
          if (typeof player.on === "function") player.on("error", errorHandler);
          var events = (dashjs.MediaPlayer && dashjs.MediaPlayer.events) || dashjs.events || {};
          var names = [events.STREAM_INITIALIZED || "streamInitialized", events.TRACK_CHANGE_RENDERED || "trackChangeRendered", events.CURRENT_TRACK_CHANGED || "currentTrackChanged"];
          names.filter(function (event, index) { return event && names.indexOf(event) === index; }).forEach(function (event) {
            player.on(event, announceTracks);
            trackHandlers.push({ event: event, handler: announceTracks });
          });
          player.initialize(media, config.url, true);
          announceTracks();
        });
      },
      getAudioTracks: function () {
        return audioTracks();
      },
      selectAudioTrack: function (id) {
        if (!player || typeof player.setCurrentTrack !== "function") return false;
        var list = this.getAudioTracks();
        var chosen = list[Number(id)];
        if (!chosen || !chosen.track) return false;
        try {
          player.setCurrentTrack(chosen.track);
          announceTracks();
          return true;
        } catch (error) {
          return false;
        }
      },
      destroy: function () {
        if (!base.markDestroyed()) return;
        scope.dispose();
        if (player) {
          try {
            if (errorHandler && typeof player.off === "function") player.off("error", errorHandler);
            if (typeof player.off === "function") trackHandlers.forEach(function (entry) { player.off(entry.event, entry.handler); });
            if (typeof player.reset === "function") player.reset();
            if (typeof player.destroy === "function") player.destroy();
          } catch (error) {
            /* the library may already have torn itself down */
          }
          player = null;
          errorHandler = null;
          trackHandlers = [];
        }
        detachMedia(media);
      }
    };
    return api;
  }

  var FACTORIES = { native: createNativeAdapter, hls: createHlsAdapter, dash: createDashAdapter };

  /**
   * Pick the adapter for a stream kind. HLS with native support stays on the
   * native adapter so Chrome's own pipeline is used instead of hls.js.
   */
  function adapterKindFor(streamKind, caps) {
    if (streamKind === "dash") return "dash";
    if (streamKind === "hls") return caps && caps.nativeHls ? "native" : "hls";
    return "native";
  }

  function createAdapter(kind, config) {
    var factory = FACTORIES[kind];
    if (!factory) throw new Error("Unknown adapter kind: " + kind);
    return factory(config);
  }

  global.AstraPlayback = global.AstraPlayback || {};
  global.AstraPlayback.adapters = {
    createResourceScope: createResourceScope,
    createAdapter: createAdapter,
    createNativeAdapter: createNativeAdapter,
    createHlsAdapter: createHlsAdapter,
    createDashAdapter: createDashAdapter,
    adapterKindFor: adapterKindFor,
    detachMedia: detachMedia
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
