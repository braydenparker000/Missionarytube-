/**
 * Astra stream normalization, compatibility evaluation and ranking.
 *
 * Three separable concerns, in dependency order:
 *
 *   normalize()  raw add-on stream -> structured facts, original preserved
 *   evaluate()   facts + browser capabilities -> compatibility state + reasons
 *   rank()       evaluated streams + owner settings -> deterministic order
 *
 * Nothing here touches the DOM or the network. Capability probing is injected
 * so the same code runs in the browser and in Node tests. No speculative
 * HEAD/range requests are ever made: they break under CORS, can burn one-shot
 * signed URLs, and would leak configured stream tokens.
 */
(function (global) {
  "use strict";


  var KIND = {
    DIRECT: "direct",
    HLS: "hls",
    DASH: "dash",
    YOUTUBE: "youtube",
    EXTERNAL: "external",
    TORRENT: "torrent",
    UNKNOWN: "unknown"
  };

  var STATE = {
    READY: "ready",
    PROBABLY_READY: "probably-ready",
    EXTERNAL: "requires-external",
    UNSUPPORTED: "unsupported",
    UNSAFE: "unsafe"
  };

  // Compact chip wording. The full sentence stays in the reasons and the row's
  // accessible label; the chip only has room for a word.
  var STATE_SHORT = {
    "ready": "Ready",
    "probably-ready": "Likely",
    "requires-external": "External",
    "unsupported": "Blocked",
    "unsafe": "Unsafe"
  };

  var STATE_LABEL = {
    "ready": "Browser ready",
    "probably-ready": "Probably ready",
    "requires-external": "Needs another app",
    "unsupported": "Not playable here",
    "unsafe": "Unsafe source"
  };

  var SAFE_PROTOCOLS = ["http:", "https:", "blob:"];
  var RESOLUTIONS = ["2160p", "1080p", "720p", "480p", "360p"];

  function str(value) {
    return value == null ? "" : String(value);
  }

  function firstMatch(text, pattern) {
    var match = text.match(pattern);
    return match ? match[1] || match[0] : "";
  }

  /**
   * Parse a URL without throwing. Returns null for anything unparseable so
   * every caller has one shape to handle.
   */
  function parseUrl(value, base) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      return new URL(value, base || undefined);
    } catch (error) {
      return null;
    }
  }

  function isSafeUrl(parsed) {
    return !!parsed && SAFE_PROTOCOLS.indexOf(parsed.protocol) !== -1;
  }

  function pathOf(parsed, fallback) {
    if (parsed) return parsed.pathname || "";
    return str(fallback).split("?")[0].split("#")[0];
  }

  function detectKind(raw, parsed) {
    if (raw.ytId) return KIND.YOUTUBE;
    if (raw.url) {
      var path = pathOf(parsed, raw.url).toLowerCase();
      var hint = str(raw.behaviorHints && raw.behaviorHints.streamType).toLowerCase();
      if (/\.m3u8?$/.test(path) || hint === "hls") return KIND.HLS;
      if (/\.mpd$/.test(path) || hint === "dash") return KIND.DASH;
      return KIND.DIRECT;
    }
    if (raw.infoHash) return KIND.TORRENT;
    if (raw.externalUrl) return KIND.EXTERNAL;
    return KIND.UNKNOWN;
  }

  var CONTAINERS = {
    mp4: "MP4",
    m4v: "MP4",
    webm: "WebM",
    mkv: "MKV",
    avi: "AVI",
    mov: "MOV",
    ts: "TS",
    mp3: "MP3",
    m4a: "M4A",
    aac: "AAC",
    flac: "FLAC",
    ogg: "OGG",
    opus: "Opus",
    wav: "WAV"
  };

  var AUDIO_CONTAINERS = ["MP3", "M4A", "AAC", "FLAC", "OGG", "Opus", "WAV"];

  function detectContainer(parsed, raw) {
    var candidates = [pathOf(parsed, raw.url), str(raw.behaviorHints && raw.behaviorHints.filename)];
    for (var i = 0; i < candidates.length; i += 1) {
      var ext = firstMatch(candidates[i].toLowerCase(), /\.([a-z0-9]{2,5})$/);
      if (ext && CONTAINERS[ext]) return CONTAINERS[ext];
    }
    return "";
  }

  function normalizeResolution(value) {
    var lower = str(value).toLowerCase();
    if (!lower) return "";
    if (lower === "4k" || lower === "uhd" || lower === "2160" || lower === "2160p") return "2160p";
    if (lower === "fhd" || lower === "1080" || lower === "1080p") return "1080p";
    if (lower === "hd" || lower === "720" || lower === "720p") return "720p";
    if (lower === "480" || lower === "480p") return "480p";
    if (lower === "360" || lower === "360p") return "360p";
    return "";
  }

  function detectCodec(text) {
    if (/\bav1\b/i.test(text)) return "AV1";
    if (/\b(?:hevc|x265|h\.?\s?265)\b/i.test(text)) return "HEVC";
    if (/\b(?:avc|x264|h\.?\s?264)\b/i.test(text)) return "H.264";
    if (/\bvp9\b/i.test(text)) return "VP9";
    return "";
  }

  function detectHdr(text) {
    if (/\b(?:dolby\s*vision|dovi)\b/i.test(text) || /\bdv\b/.test(text)) return "Dolby Vision";
    if (/\bhdr10\+/i.test(text)) return "HDR10+";
    if (/\bhdr10\b/i.test(text)) return "HDR10";
    if (/\bhdr\b/i.test(text)) return "HDR";
    return "";
  }

  function detectAudioCodec(text) {
    if (/\batmos\b/i.test(text)) return "Atmos";
    if (/\btruehd\b/i.test(text)) return "TrueHD";
    if (/\bdts[-\s]?hd\b/i.test(text)) return "DTS-HD";
    if (/\bdts\b/i.test(text)) return "DTS";
    if (/\b(?:eac3|ddp|dd\+)\b/i.test(text)) return "EAC3";
    if (/\b(?:ac3|dd)\b/i.test(text)) return "AC3";
    if (/\bflac\b/i.test(text)) return "FLAC";
    if (/\bopus\b/i.test(text)) return "Opus";
    if (/\baac\b/i.test(text)) return "AAC";
    if (/\bmp3\b/i.test(text)) return "MP3";
    return "";
  }

  function detectChannels(text) {
    var match = text.match(/\b([2578])\.([01])\b/);
    return match ? match[1] + "." + match[2] : "";
  }

  var SIZE_UNITS = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 };

  function detectSize(raw, text) {
    var hinted = Number(raw.behaviorHints && raw.behaviorHints.videoSize);
    if (Number.isFinite(hinted) && hinted > 0) return hinted;
    var match = text.match(/\b(\d+(?:[.,]\d+)?)\s*(tb|gb|mb|kb)\b/i);
    if (!match) return 0;
    var amount = Number(String(match[1]).replace(",", "."));
    if (!Number.isFinite(amount)) return 0;
    return Math.round(amount * SIZE_UNITS[match[2].toLowerCase()]);
  }

  function formatSize(bytes) {
    if (!bytes) return "";
    if (bytes >= 1e12) return (bytes / 1e12).toFixed(1) + " TB";
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
    if (bytes >= 1e6) return Math.round(bytes / 1e6) + " MB";
    return Math.round(bytes / 1e3) + " KB";
  }

  /**
   * Cached/debrid hints. Add-ons signal this with words, a lightning bolt, or a
   * provider tag such as [RD+] / [AD+] / [TB+].
   */
  function detectCached(text) {
    if (/\bcached\b/i.test(text)) return true;
    if (/⚡|instant/i.test(text)) return true;
    return /\[\s*(?:rd|ad|tb|pm|dl|oc)\s*\+\s*\]/i.test(text) || /\b(?:rd|ad|tb)\+/i.test(text);
  }

  function detectLive(raw, text) {
    if (raw.behaviorHints && raw.behaviorHints.isLive === true) return true;
    return /\blive\b|\b24\/7\b/i.test(text);
  }

  /**
   * Turn one raw add-on stream into a structured record. Every field access is
   * defensive: a malformed object yields an `unknown`/`unsafe` stream rather
   * than throwing into the render path.
   */
  function normalize(input, context) {
    var options = context || {};
    var raw = input && typeof input === "object" ? input : {};
    var hints = raw.behaviorHints && typeof raw.behaviorHints === "object" ? raw.behaviorHints : {};
    var pageUrl = options.pageUrl || "";
    var parsed = raw.url ? parseUrl(raw.url, pageUrl) : null;
    var externalParsed = raw.externalUrl ? parseUrl(raw.externalUrl, pageUrl) : null;

    var title = str(raw.name || raw.title).trim();
    var description = str(raw.description || raw.title).trim();
    var text = [raw.name, raw.title, raw.description, hints.filename].map(str).join(" ");

    var kind = detectKind(raw, parsed);
    var container = detectContainer(parsed, raw);
    var resolution =
      normalizeResolution(firstMatch(text, /\b(2160p?|1080p?|720p?|480p?|360p?|4k|uhd|fhd)\b/i)) ||
      normalizeResolution(raw.resolution);

    var sizeBytes = detectSize(raw, text);

    return {
      raw: input,
      index: Number.isFinite(options.index) ? options.index : 0,
      addonName: str(raw._addonName || options.addonName),
      addonOrder: Number.isFinite(options.addonOrder) ? options.addonOrder : 0,
      kind: kind,
      url: parsed && isSafeUrl(parsed) ? parsed.href : str(raw.url),
      urlSafe: raw.url ? isSafeUrl(parsed) : true,
      urlProtocol: parsed ? parsed.protocol : "",
      ytId: str(raw.ytId),
      externalUrl: externalParsed ? externalParsed.href : str(raw.externalUrl),
      externalSafe: raw.externalUrl ? isSafeUrl(externalParsed) : false,
      infoHash: str(raw.infoHash),
      title: title || (kind === KIND.UNKNOWN ? "Unknown source" : kind.toUpperCase() + " stream"),
      description: description === title ? "" : description,
      subtitles: Array.isArray(raw.subtitles) ? raw.subtitles : [],
      behaviorHints: hints,
      facts: {
        resolution: resolution,
        resolutionRank: resolution ? RESOLUTIONS.length - RESOLUTIONS.indexOf(resolution) : 0,
        codec: detectCodec(text),
        container: container,
        hdr: detectHdr(text),
        audioCodec: detectAudioCodec(text),
        audioChannels: detectChannels(text),
        sizeBytes: sizeBytes,
        sizeText: formatSize(sizeBytes),
        cached: detectCached(text),
        live: detectLive(raw, text),
        audioOnly: AUDIO_CONTAINERS.indexOf(container) !== -1,
        filename: str(hints.filename),
        notWebReady: hints.notWebReady === true,
        proxyHeaders: !!hints.proxyHeaders
      }
    };
  }

  function normalizeAll(list, context) {
    if (!Array.isArray(list)) return [];
    var options = context || {};
    return list.map(function (item, index) {
      return normalize(item, {
        index: index,
        pageUrl: options.pageUrl,
        addonName: options.addonName,
        addonOrder: options.addonOrder
      });
    });
  }

  /* ---------------------------------------------------------------- *
   * Compatibility evaluation
   * ---------------------------------------------------------------- */

  /**
   * A capability probe with every browser API guarded. Callers in Node pass a
   * plain object; the browser integration passes `browserCapabilities()`.
   */
  function capabilities(overrides) {
    var given = overrides || {};
    return {
      pageProtocol: given.pageProtocol || "https:",
      canPlayType: typeof given.canPlayType === "function" ? given.canPlayType : function () { return ""; },
      hlsSupported: given.hlsSupported === true,
      dashSupported: given.dashSupported === true,
      nativeHls: given.nativeHls === true,
      decodingInfo: typeof given.decodingInfo === "function" ? given.decodingInfo : null
    };
  }

  function browserCapabilities(win) {
    var w = win || global;
    var doc = w.document;
    var probe = doc && doc.createElement ? doc.createElement("video") : null;
    var canPlayType = function (type) {
      if (!probe || typeof probe.canPlayType !== "function") return "";
      try {
        return probe.canPlayType(type) || "";
      } catch (error) {
        return "";
      }
    };
    var nativeHls = canPlayType("application/vnd.apple.mpegurl") !== "";
    var mediaCapabilities = w.navigator && w.navigator.mediaCapabilities;
    // hls.js and dash.js are lazy loaded on demand, so they count as available
    // unless the caller says otherwise (used by tests and by the engine after a
    // library load has actually failed).
    var options = (win && win.__astraLibraries) || {};
    return capabilities({
      pageProtocol: (w.location && w.location.protocol) || "https:",
      canPlayType: canPlayType,
      nativeHls: nativeHls,
      hlsSupported: options.hls === false ? nativeHls : true,
      dashSupported: options.dash !== false,
      decodingInfo:
        mediaCapabilities && typeof mediaCapabilities.decodingInfo === "function"
          ? mediaCapabilities.decodingInfo.bind(mediaCapabilities)
          : null
    });
  }

  var MIME_BY_CONTAINER = {
    MP4: "video/mp4",
    WebM: "video/webm",
    MKV: "video/x-matroska",
    AVI: "video/x-msvideo",
    MOV: "video/quicktime",
    TS: "video/mp2t",
    MP3: "audio/mpeg",
    M4A: "audio/mp4",
    AAC: "audio/aac",
    FLAC: "audio/flac",
    OGG: "audio/ogg",
    Opus: "audio/ogg",
    WAV: "audio/wav"
  };

  // Conservative, widely-correct codec strings. Only emitted when the codec is
  // known, so `decodingInfo` is never asked about a guess.
  var CODEC_STRING = {
    "H.264": "avc1.640029",
    HEVC: "hvc1.1.6.L93.B0",
    AV1: "av01.0.05M.08",
    VP9: "vp09.00.10.08"
  };

  // Which codecs can actually appear in which container. An add-on title is
  // free text: "x264" next to a .webm URL is a mislabel, not a real pairing.
  var CODECS_BY_CONTAINER = {
    MP4: ["H.264", "HEVC", "AV1"],
    MOV: ["H.264", "HEVC"],
    TS: ["H.264", "HEVC"],
    WebM: ["VP8", "VP9", "AV1"]
  };

  /**
   * Build a content type only when it is genuinely reliable: a known container,
   * plus a codec only when that codec can actually live in that container.
   * A mismatched pair falls back to the bare container type, so a sloppy title
   * downgrades confidence instead of declaring a playable source unsupported.
   */
  function contentTypeFor(stream) {
    var facts = stream.facts;
    var mime = MIME_BY_CONTAINER[facts.container];
    if (!mime) return "";
    if (!facts.codec) return mime;
    var codec = CODEC_STRING[facts.codec];
    if (!codec) return mime;
    var allowed = CODECS_BY_CONTAINER[facts.container];
    if (allowed && allowed.indexOf(facts.codec) === -1) return mime;
    return mime + '; codecs="' + codec + '"';
  }

  function reason(code, text) {
    return { code: code, text: text };
  }

  /**
   * Classify a normalized stream. Returns a state plus the reasons behind it,
   * never a bare boolean, so the UI can explain itself and tests can assert on
   * stable codes.
   */
  function evaluate(stream, caps) {
    var probe = capabilities(caps);
    var facts = stream.facts;
    var reasons = [];
    var contentType = "";

    function result(state, confidence) {
      return {
        state: state,
        label: STATE_LABEL[state],
        confidence: confidence,
        reasons: reasons,
        contentType: contentType,
        playable: state === STATE.READY || state === STATE.PROBABLY_READY
      };
    }

    if (stream.kind === KIND.UNKNOWN) {
      reasons.push(reason("no-source", "The add-on returned no playable URL."));
      return result(STATE.UNSUPPORTED, 0);
    }

    if (stream.kind === KIND.TORRENT) {
      reasons.push(reason("torrent", "Chrome cannot stream a BitTorrent info hash directly."));
      return result(STATE.EXTERNAL, 0);
    }

    if (stream.kind === KIND.EXTERNAL) {
      if (!stream.externalSafe) {
        reasons.push(reason("unsafe-url", "The external link uses an unsupported scheme."));
        return result(STATE.UNSAFE, 0);
      }
      reasons.push(reason("external", "Opens in a new tab outside Astra."));
      return result(STATE.EXTERNAL, 0);
    }

    if (stream.kind === KIND.YOUTUBE) {
      reasons.push(reason("youtube", "Plays through the privacy-friendly YouTube embed."));
      return result(STATE.READY, 0.95);
    }

    if (!stream.urlSafe) {
      reasons.push(reason("unsafe-url", "The stream URL uses an unsupported or unsafe scheme."));
      return result(STATE.UNSAFE, 0);
    }

    if (probe.pageProtocol === "https:" && stream.urlProtocol === "http:") {
      reasons.push(reason("mixed-content", "Chrome blocks plain HTTP media on an HTTPS page."));
      return result(STATE.UNSAFE, 0);
    }

    if (facts.proxyHeaders) {
      reasons.push(reason("proxy-headers", "This source needs custom request headers a browser cannot send."));
      return result(STATE.UNSUPPORTED, 0);
    }

    if (stream.kind === KIND.HLS) {
      if (!probe.nativeHls && !probe.hlsSupported) {
        reasons.push(reason("no-hls", "HLS playback needs hls.js, which is unavailable."));
        return result(STATE.UNSUPPORTED, 0);
      }
      reasons.push(
        probe.nativeHls
          ? reason("hls-native", "HLS is supported natively by this browser.")
          : reason("hls-js", "Plays through the pinned hls.js runtime.")
      );
      if (facts.live) reasons.push(reason("live", "Live stream."));
      return result(STATE.READY, probe.nativeHls ? 0.9 : 0.8);
    }

    if (stream.kind === KIND.DASH) {
      if (!probe.dashSupported) {
        reasons.push(reason("no-dash", "DASH playback needs dash.js, which is unavailable."));
        return result(STATE.UNSUPPORTED, 0);
      }
      reasons.push(reason("dash-js", "Plays through the pinned dash.js runtime."));
      if (facts.live) reasons.push(reason("live", "Live stream."));
      return result(STATE.READY, 0.78);
    }

    // Direct progressive delivery.
    if (facts.notWebReady) {
      reasons.push(reason("not-web-ready", "The add-on marked this file as not browser ready."));
      return result(STATE.UNSUPPORTED, 0);
    }

    if (facts.container === "MKV" || facts.container === "AVI") {
      reasons.push(reason("container", facts.container + " rarely plays in Chrome without transcoding."));
      return result(STATE.UNSUPPORTED, 0);
    }

    contentType = contentTypeFor(stream);
    var verdict = contentType ? probe.canPlayType(contentType) : "";

    if (verdict === "probably") {
      reasons.push(reason("can-play", "Chrome reports it can play this container and codec."));
      return result(STATE.READY, 0.95);
    }

    if (verdict === "maybe") {
      reasons.push(reason("can-play-maybe", "Chrome may be able to play this codec."));
      return result(STATE.PROBABLY_READY, 0.6);
    }

    if (contentType && verdict === "") {
      reasons.push(reason("cannot-play", "Chrome reports it cannot decode " + (facts.codec || facts.container) + "."));
      return result(STATE.UNSUPPORTED, 0);
    }

    if (facts.codec === "HEVC" || facts.hdr === "Dolby Vision") {
      reasons.push(reason("device-codec", (facts.hdr === "Dolby Vision" ? "Dolby Vision" : "HEVC") + " support depends on the device."));
      return result(STATE.PROBABLY_READY, 0.45);
    }

    reasons.push(reason("unverified", "Container not declared, so playback is unconfirmed."));
    return result(STATE.PROBABLY_READY, 0.5);
  }

  /**
   * Optional async refinement using MediaCapabilities. Only candidates with a
   * reliable content type are probed, and only the first `limit` of them, so
   * this never becomes a broad scan. Failure leaves the sync verdict intact.
   */
  function refineWithDecodingInfo(evaluated, caps, limit) {
    var probe = capabilities(caps);
    if (!probe.decodingInfo) return Promise.resolve(evaluated);
    var budget = Number.isFinite(limit) ? limit : 5;

    // Only probe a content type that actually names a codec. MediaCapabilities
    // cannot answer for a bare container type and reports it as unsupported,
    // which would hide a perfectly playable source.
    var pending = evaluated.slice(0, budget).filter(function (entry) {
      return (
        entry.stream.kind === KIND.DIRECT &&
        entry.evaluation.contentType &&
        entry.evaluation.contentType.indexOf("codecs=") !== -1
      );
    });

    return Promise.all(
      pending.map(function (entry) {
        return Promise.resolve()
          .then(function () {
            return probe.decodingInfo({
              type: "file",
              video: { contentType: entry.evaluation.contentType, width: 1920, height: 1080, bitrate: 4000000, framerate: 24 }
            });
          })
          .then(function (info) {
            if (!info || typeof info !== "object") return;
            if (info.supported === false) {
              entry.evaluation.state = STATE.UNSUPPORTED;
              entry.evaluation.label = STATE_LABEL[STATE.UNSUPPORTED];
              entry.evaluation.playable = false;
              entry.evaluation.confidence = 0;
              entry.evaluation.reasons.push(reason("decoding-info", "The device reports it cannot decode this source."));
            } else if (info.supported === true && info.smooth === true) {
              entry.evaluation.state = STATE.READY;
              entry.evaluation.label = STATE_LABEL[STATE.READY];
              entry.evaluation.playable = true;
              entry.evaluation.confidence = Math.max(entry.evaluation.confidence, 0.97);
              entry.evaluation.reasons.push(reason("decoding-info", "The device reports smooth decoding."));
            }
          })
          .catch(function () {
            /* MediaCapabilities is advisory; keep the synchronous verdict. */
          });
      })
    ).then(function () {
      return evaluated;
    });
  }

  /* ---------------------------------------------------------------- *
   * Deterministic ranking
   * ---------------------------------------------------------------- */

  var STATE_TIER = {
    "ready": 3,
    "probably-ready": 2,
    "requires-external": 1,
    "unsupported": 0,
    "unsafe": 0
  };

  /**
   * The owner's ceiling expressed on the same scale as `facts.resolutionRank`,
   * so the two are directly comparable.
   */
  function resolutionCeiling(settings) {
    var index = RESOLUTIONS.indexOf(normalizeResolution(settings && settings.maxResolution));
    return index === -1 ? RESOLUTIONS.length : RESOLUTIONS.length - index;
  }

  /**
   * Score one candidate. Factors are additive and each contributes a labelled
   * entry so the UI can show "Why this source" and tests can assert on the
   * reasoning rather than just the final order.
   */
  function score(entry, settings) {
    var facts = entry.stream.facts;
    var evaluation = entry.evaluation;
    var factors = [];
    var total = 0;

    // `display:false` marks a factor that moves the score but says nothing a
    // viewer would act on, so it stays out of the "Why this source" line.
    function add(points, label, display) {
      if (!points) return;
      total += points;
      factors.push({ points: points, label: label, display: display !== false });
    }

    add(STATE_TIER[evaluation.state] * 1000, evaluation.label, false);
    add(Math.round(evaluation.confidence * 120), "Compatibility confidence", false);

    var ceiling = resolutionCeiling(settings);
    if (facts.resolutionRank) {
      if (facts.resolutionRank > ceiling) {
        add(-260, "Above your " + settings.maxResolution + " limit");
      } else {
        add(facts.resolutionRank * 45, facts.resolution);
      }
    }

    if (facts.cached) {
      add(settings.preferCached ? 320 : 60, "Cached by your debrid service");
    }

    if (facts.hdr) {
      if (settings.hdrPreference === "prefer") add(90, facts.hdr + " preferred");
      else if (settings.hdrPreference === "avoid") add(-140, facts.hdr + " avoided");
    }

    if (entry.stream.kind === KIND.DIRECT) add(40, "Direct file, no extra runtime");
    else if (entry.stream.kind === KIND.HLS) add(25, "Adaptive HLS");
    else if (entry.stream.kind === KIND.DASH) add(15, "Adaptive DASH");

    if (facts.codec === "H.264") add(60, "H.264 plays almost everywhere");
    else if (facts.codec === "VP9") add(30, "VP9 is well supported in Chrome");
    else if (facts.codec === "HEVC") add(-45, "HEVC depends on device support");
    else if (facts.codec === "AV1") add(-20, "AV1 depends on device support");

    // Very large files are a poor default over mobile data.
    if (facts.sizeBytes > 2.5e10) add(-90, "Very large file");
    else if (facts.sizeBytes && facts.sizeBytes < 6e9) add(20, "Reasonable size");

    return { total: total, factors: factors };
  }

  function compare(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    // Stable, explainable tiebreakers: configured add-on order, then the order
    // the add-on itself returned.
    if (a.stream.addonOrder !== b.stream.addonOrder) return a.stream.addonOrder - b.stream.addonOrder;
    if (a.stream.index !== b.stream.index) return a.stream.index - b.stream.index;
    return 0;
  }

  /**
   * Evaluate and order every candidate. Returns entries carrying the stream,
   * its evaluation, its score and a short human explanation.
   */
  function rank(streams, options) {
    var config = options || {};
    var settingsModule = global.AstraPlayback && global.AstraPlayback.settings;
    var owner = config.settings || (settingsModule ? settingsModule.DEFAULTS : {});
    var caps = config.capabilities;

    var entries = (Array.isArray(streams) ? streams : []).map(function (stream, index) {
      var normalized = stream && stream.facts ? stream : normalize(stream, { index: index, pageUrl: config.pageUrl });
      return { stream: normalized, evaluation: evaluate(normalized, caps) };
    });

    entries.forEach(function (entry) {
      var scored = score(entry, owner);
      entry.score = scored.total;
      entry.factors = scored.factors;
      entry.why = explain(entry);
    });

    return entries.slice().sort(compare);
  }

  /**
   * One short line for the UI. A playable source explains why it was chosen;
   * an unplayable one explains what is blocking it, which is the only thing
   * worth reading on a source you cannot start.
   */
  function explain(entry) {
    if (!entry.evaluation.playable) {
      var blocking = entry.evaluation.reasons[0];
      return blocking ? blocking.text : entry.evaluation.label;
    }
    var positives = entry.factors
      .filter(function (factor) {
        return factor.points > 0 && factor.display;
      })
      .sort(function (a, b) {
        return b.points - a.points;
      })
      .slice(0, 3)
      .map(function (factor) {
        return factor.label;
      });
    // A source with nothing distinguishing still needs to say something.
    if (!positives.length) {
      var first = entry.evaluation.reasons[0];
      return first ? first.text : entry.evaluation.label;
    }
    return positives.join(" · ");
  }

  /** The best candidate Astra should start with, or null if none can play. */
  function bestCandidate(ranked) {
    for (var i = 0; i < ranked.length; i += 1) {
      if (ranked[i].evaluation.playable) return ranked[i];
    }
    return null;
  }

  /** Short chip labels for the picker UI. */
  function tagsFor(stream) {
    var facts = stream.facts;
    return [facts.resolution, facts.codec, facts.hdr, facts.audioCodec, facts.audioChannels, facts.sizeText]
      .filter(Boolean);
  }

  global.AstraPlayback = global.AstraPlayback || {};
  global.AstraPlayback.streams = {
    KIND: KIND,
    STATE: STATE,
    STATE_LABEL: STATE_LABEL,
    STATE_SHORT: STATE_SHORT,
    normalize: normalize,
    normalizeAll: normalizeAll,
    capabilities: capabilities,
    browserCapabilities: browserCapabilities,
    contentTypeFor: contentTypeFor,
    evaluate: evaluate,
    refineWithDecodingInfo: refineWithDecodingInfo,
    rank: rank,
    score: score,
    explain: explain,
    bestCandidate: bestCandidate,
    tagsFor: tagsFor,
    formatSize: formatSize
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
