/**
 * Astra player adapters and resource scopes.
 *
 * One contract covers native media, HLS and DASH:
 *
 *   { kind, attach(): Promise<void>, destroy(): void,
 *     getAudioTracks(), selectAudioTrack(id),
 *     getVideoQualities(), selectVideoQuality(id) }
 *
 * A quality list is empty when the delivery has nothing to switch between:
 * a progressive file is one rendition by definition, and only the adaptive
 * adapters can move between representations without reloading.
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

    function emitVideoQualitiesChanged(qualities) {
      if (destroyed) return;
      if (typeof events.onVideoQualitiesChanged === "function") events.onVideoQualitiesChanged(qualities || []);
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
      emitVideoQualitiesChanged: emitVideoQualitiesChanged,
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
          if (config.requestPolicy && config.requestPolicy.required) throw global.AstraPlayback.requests.error();
          media.src = config.url;
          bindTrackEvents();
          scope.listen(media, "loadedmetadata", function () {
            bindTrackEvents();
            announceTracks();
          });
          if (config.autoplay !== false && typeof media.play === "function") {
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
      // A progressive file is one quality by definition. Changing it means
      // loading a different file, which is the caller's decision, not the
      // adapter's, so this reports nothing rather than pretending to switch.
      getVideoQualities: function () {
        return [];
      },
      selectVideoQuality: function () {
        return false;
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
    // "und" is the container saying it does not know, which is not a language
    // and must not be drawn as one.
    if (!value || value === "und" || value === "undefined" || value === "mul") return "";
    var aliases = { eng: "en", jpn: "ja", spa: "es", fra: "fr", fre: "fr", deu: "de", ger: "de", por: "pt", ita: "it", kor: "ko", zho: "zh", chi: "zh" };
    var parts = value.split("-");
    if (aliases[parts[0]]) parts[0] = aliases[parts[0]];
    return parts.join("-");
  }

  var CODEC_WORDS = [
    [/opus/i, "Opus"], [/vorbis/i, "Vorbis"], [/flac/i, "FLAC"],
    [/ec-3|eac3/i, "EAC3"], [/ac-3|\bac3\b/i, "AC3"], [/mp4a|\baac\b/i, "AAC"],
    [/mp3|mpeg/i, "MP3"], [/alac/i, "ALAC"]
  ];

  /**
   * A codec name a person can read. hls.js reports a bare codec string, but
   * dash.js reports a full MIME type - and `audio/webm;codecs="opus"` drawn on
   * a 44px button is the library's internal detail leaking into the UI.
   */
  function codecLabel(value) {
    var raw = String(value == null ? "" : value).trim();
    if (!raw) return "";
    for (var i = 0; i < CODEC_WORDS.length; i += 1) {
      if (CODEC_WORDS[i][0].test(raw)) return CODEC_WORDS[i][1];
    }
    // Not a codec we have a word for: keep it only if it is short enough to be
    // a codec rather than a MIME type.
    if (raw.indexOf("/") !== -1 || raw.length > 12) return "";
    return raw.toUpperCase();
  }

  function trackLabel(track, index) {
    var language = trackLanguage(track);
    var named = track && (track.name || track.label || (track.labels && track.labels[0] && track.labels[0].text));
    var languageNames = { en: "english", es: "spanish", fr: "french", de: "german", pt: "portuguese", it: "italian", ja: "japanese", ko: "korean", zh: "chinese" };
    var details = [];
    var codec = codecLabel(track && (track.codec || track.audioCodec));
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

    /** hls.js renditions, with -1 as its own "auto" level. */
    function videoQualities() {
      if (!instance || !Array.isArray(instance.levels) || instance.levels.length < 2) return [];
      var current = Number(instance.currentLevel);
      var list = [{ id: "auto", label: "Auto", height: 0, bitrate: 0, auto: true, active: current === -1 }];
      instance.levels.forEach(function (level, index) {
        list.push({
          id: String(index),
          label: level && level.height ? level.height + "p" : "Level " + (index + 1),
          height: Number(level && level.height) || 0,
          bitrate: Number(level && level.bitrate) || 0,
          auto: false,
          active: current === index
        });
      });
      return list;
    }

    function announceQualities() {
      base.emitVideoQualitiesChanged(videoQualities());
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
          var hlsConfig = { enableWorker: true, lowLatencyMode: true };
          if (config.requestPolicy && config.requestPolicy.required) {
            if (!config.requestPolicy.supported) throw global.AstraPlayback.requests.error();
            // In the pinned hls.js release progressive:true selects FetchLoader.
            // XHR cannot prevent credential-bearing redirects, so fail closed
            // if an older browser cannot activate the fetch loader.
            hlsConfig.progressive = true;
            hlsConfig.fetchSetup = function (context, init) {
              return new Request(context.url, global.AstraPlayback.requests.fetchInit(config.requestPolicy, context.url, init));
            };
            hlsConfig.xhrSetup = function () { throw global.AstraPlayback.requests.error(); };
          }
          instance = new Hls(hlsConfig);
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
          var levelEvents = [events.MANIFEST_PARSED || "manifestParsed", events.LEVEL_SWITCHED || "levelSwitched"];
          levelEvents.filter(function (event, index) { return event && levelEvents.indexOf(event) === index; }).forEach(function (event) {
            instance.on(event, announceQualities);
          });
          instance.loadSource(config.url);
          instance.attachMedia(media);
          announceTracks();
          announceQualities();
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
      getVideoQualities: function () {
        return videoQualities();
      },
      selectVideoQuality: function (id) {
        if (!instance || !Array.isArray(instance.levels)) return false;
        if (String(id) === "auto") {
          instance.currentLevel = -1;
          announceQualities();
          return true;
        }
        var index = Number(id);
        if (!Number.isInteger(index) || index < 0 || index >= instance.levels.length) return false;
        // hls.js keeps the playhead across a level switch on its own.
        instance.currentLevel = index;
        announceQualities();
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

  /**
   * dash.js 5.2's default XHR loader follows redirects; its fetch loader also
   * omits Request.redirect. Replace both only for header-bearing sources,
   * retaining dash.js's range requests, retries, progress and cancellation.
   */
  function createDashFetchLoader(policy, fetcher) {
    var active = new Set();
    var boxParser = null;
    function stop(run, notify) {
      if (!active.delete(run)) return;
      run.controller.abort();
      clearTimeout(run.timer);
      if (notify && run.request.customData.onabort) run.request.customData.onabort();
    }
    function abort(request) {
      Array.from(active).forEach(function (run) { if (!request || request === run.request) stop(run, true); });
    }
    return {
      setConfig: function (options) { boxParser = options && options.boxParser; },
      getXhr: function () { return null; },
      abort: abort,
      reset: function () { abort(); },
      resetInitialSettings: function () { abort(); },
      load: function (request, response) {
        var run = { request: request, controller: new AbortController(), timer: null };
        request.customData = request.customData || {};
        request.customData.abort = function () { stop(run, true); };
        active.add(run);
        var finished = function () {
          if (!active.delete(run)) return;
          clearTimeout(run.timer);
          if (request.customData.onloadend) request.customData.onloadend();
        };
        if (request.timeout > 0) run.timer = setTimeout(function () {
          run.controller.abort();
          response.status = 0;
          if (request.customData.ontimeout) request.customData.ontimeout({ lengthComputable: false });
          finished();
        }, request.timeout);
        Promise.resolve().then(function () {
          if (!active.has(run)) return null;
          var init = global.AstraPlayback.requests.fetchInit(policy, request.url, {
            method: request.method || "GET", body: request.body || undefined,
            headers: request.headers || {}, signal: run.controller.signal
          });
          return (fetcher || global.fetch)(request.url, init);
        }).then(async function (result) {
          if (!active.has(run)) return;
          response.url = result.url || request.url;
          response.status = result.status;
          response.statusText = result.statusText;
          response.headers = {};
          result.headers.forEach(function (value, name) { response.headers[name] = value; });
          var length = Number(result.headers.get("content-length")) || 0;
          var chunks = [], loaded = 0;
          var progressive = boxParser && request.responseType === "arraybuffer" && request.customData.request && request.customData.request.availabilityTimeComplete === false;
          var pending = new Uint8Array(0);
          if (result.body) {
            var reader = result.body.getReader();
            for (;;) {
              var part = await reader.read();
              if (!active.has(run)) { await reader.cancel(); return; }
              if (part.done) break;
              loaded += part.value.byteLength;
              if (progressive && request.customData.onprogress) {
                var joined = new Uint8Array(pending.byteLength + part.value.byteLength);
                joined.set(pending); joined.set(part.value, pending.byteLength); pending = joined;
                var box = boxParser.findLastTopIsoBoxCompleted(["moov", "mdat"], pending, 0);
                if (box.found) {
                  var end = box.startOffsetOfLastFoundTargetBox + box.sizeOfLastFoundTargetBox;
                  request.customData.onprogress({ data: pending.slice(0, end).buffer, noTrace: true, lengthComputable: false });
                  pending = pending.slice(end);
                }
              } else chunks.push(part.value);
              if (!active.has(run)) { await reader.cancel(); return; }
              if (request.customData.onprogress) request.customData.onprogress({ loaded: loaded, total: length || loaded, lengthComputable: length > 0 });
            }
          }
          var bytes = progressive && request.customData.onprogress ? pending : new Uint8Array(loaded), offset = 0;
          chunks.forEach(function (chunk) { bytes.set(chunk, offset); offset += chunk.byteLength; });
          response.data = request.responseType === "arraybuffer" ? bytes.buffer : new TextDecoder().decode(bytes);
          finished();
        }).catch(function () { response.status = 0; finished(); });
        return true;
      }
    };
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

    /**
     * The video representations dash.js is offering.
     *
     * dash.js renamed this API between major versions and Astra pins one
     * build, but the pin moves; asking for whichever shape the loaded library
     * actually has is cheaper than a version check that silently stops being
     * true after an upgrade.
     */
    function representations() {
      if (!player) return [];
      try {
        if (typeof player.getRepresentationsByType === "function") {
          return (player.getRepresentationsByType("video") || []).map(function (entry, index) {
            return {
              index: Number.isFinite(entry && entry.index) ? entry.index : index,
              id: entry && entry.id != null ? String(entry.id) : String(index),
              height: Number(entry && entry.height) || 0,
              bitrate: Number(entry && (entry.bandwidth || entry.bitrate)) || 0
            };
          });
        }
        if (typeof player.getBitrateInfoListFor === "function") {
          return (player.getBitrateInfoListFor("video") || []).map(function (entry, index) {
            return {
              index: Number.isFinite(entry && entry.qualityIndex) ? entry.qualityIndex : index,
              id: String(Number.isFinite(entry && entry.qualityIndex) ? entry.qualityIndex : index),
              height: Number(entry && entry.height) || 0,
              bitrate: Number(entry && entry.bitrate) || 0
            };
          });
        }
      } catch (error) {
        return [];
      }
      return [];
    }

    function abrEnabled() {
      if (!player || typeof player.getSettings !== "function") return true;
      try {
        var settings = player.getSettings() || {};
        var abr = settings.streaming && settings.streaming.abr;
        var auto = abr && abr.autoSwitchBitrate;
        return !auto || auto.video !== false;
      } catch (error) {
        return true;
      }
    }

    function currentRepresentationIndex() {
      if (!player) return -1;
      try {
        if (typeof player.getCurrentRepresentationForType === "function") {
          var current = player.getCurrentRepresentationForType("video");
          if (current && Number.isFinite(current.index)) return current.index;
        }
        if (typeof player.getQualityFor === "function") {
          var quality = player.getQualityFor("video");
          if (Number.isFinite(quality)) return quality;
        }
      } catch (error) {
        return -1;
      }
      return -1;
    }

    function videoQualities() {
      var list = representations();
      if (list.length < 2) return [];
      var auto = abrEnabled();
      var active = currentRepresentationIndex();
      var out = [{ id: "auto", label: "Auto", height: 0, bitrate: 0, auto: true, active: auto }];
      list
        .slice()
        .sort(function (a, b) { return b.height - a.height || b.bitrate - a.bitrate; })
        .forEach(function (entry) {
          out.push({
            id: String(entry.index),
            label: entry.height ? entry.height + "p" : Math.round(entry.bitrate / 1000) + " kbps",
            height: entry.height,
            bitrate: entry.bitrate,
            auto: false,
            active: !auto && entry.index === active
          });
        });
      return out;
    }

    function announceQualities() {
      base.emitVideoQualitiesChanged(videoQualities());
    }

    function setAbr(enabled) {
      if (!player || typeof player.updateSettings !== "function") return false;
      try {
        player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: !!enabled } } } });
        return true;
      } catch (error) {
        return false;
      }
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
          if (config.requestPolicy && config.requestPolicy.required) {
            if (!config.requestPolicy.supported || typeof player.extend !== "function") throw global.AstraPlayback.requests.error();
            ["XHRLoader", "FetchLoader"].forEach(function (name) {
              player.extend(name, function () { return createDashFetchLoader(config.requestPolicy, config.fetch); }, false);
            });
          }
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
          var qualityEvents = [
            events.STREAM_INITIALIZED || "streamInitialized",
            events.QUALITY_CHANGE_RENDERED || "qualityChangeRendered",
            events.REPRESENTATION_SWITCH || "representationSwitch"
          ];
          qualityEvents.filter(function (event, index) { return event && qualityEvents.indexOf(event) === index; }).forEach(function (event) {
            player.on(event, announceQualities);
            trackHandlers.push({ event: event, handler: announceQualities });
          });
          player.initialize(media, config.url, true);
          announceTracks();
          announceQualities();
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
      getVideoQualities: function () {
        return videoQualities();
      },
      /**
       * Pin one representation, or hand control back to the adaptive
       * algorithm. Both are in-place: dash.js swaps the buffered
       * representation underneath the element, so the playhead does not move
       * and nothing is re-downloaded from the start.
       */
      selectVideoQuality: function (id) {
        if (!player) return false;
        if (String(id) === "auto") {
          if (!setAbr(true)) return false;
          announceQualities();
          return true;
        }
        var wanted = Number(id);
        var list = representations();
        var chosen = null;
        for (var i = 0; i < list.length; i += 1) {
          if (list[i].index === wanted) chosen = list[i];
        }
        if (!chosen) return false;
        // ABR would immediately override a pinned representation.
        setAbr(false);
        try {
          if (typeof player.setRepresentationForTypeById === "function") {
            player.setRepresentationForTypeById("video", chosen.id, true);
          } else if (typeof player.setRepresentationForTypeByIndex === "function") {
            player.setRepresentationForTypeByIndex("video", chosen.index, true);
          } else if (typeof player.setQualityFor === "function") {
            player.setQualityFor("video", chosen.index, true);
          } else {
            setAbr(true);
            return false;
          }
        } catch (error) {
          setAbr(true);
          return false;
        }
        announceQualities();
        return true;
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
   * Pick the adapter for a stream kind.
   *
   * HLS goes to hls.js whenever Media Source Extensions are available, even on
   * a browser that claims native HLS support. This is not a preference, it is
   * the only way to reach an audio track on the primary client: Chromium has
   * never implemented `HTMLMediaElement.audioTracks` — the property does not
   * exist on the prototype — so a natively played stream has no track list to
   * offer, whatever the container carries. hls.js parses the master playlist
   * itself and switches renditions through MSE, so a dubbed release becomes
   * selectable. Native HLS stays the fallback for a browser without MSE
   * (Safari), where the native path does expose `audioTracks` anyway.
   */
  function adapterKindFor(streamKind, caps, requestPolicy) {
    if (streamKind === "dash") return "dash";
    if (streamKind === "hls") return requestPolicy && requestPolicy.required ? "hls" : caps && caps.hlsSupported === false ? "native" : "hls";
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
    codecLabel: codecLabel,
    createAdapter: createAdapter,
    createNativeAdapter: createNativeAdapter,
    createHlsAdapter: createHlsAdapter,
    createDashAdapter: createDashAdapter,
    createDashFetchLoader: createDashFetchLoader,
    adapterKindFor: adapterKindFor,
    detachMedia: detachMedia
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
