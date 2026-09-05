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
    "probably-ready": "Try playback",
    "requires-external": "External",
    "unsupported": "Blocked",
    "unsafe": "Unsafe"
  };

  var STATE_LABEL = {
    "ready": "Browser ready",
    "probably-ready": "Playback unconfirmed",
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
    if (/\b(?:dolby\s*vision|dovi)\b/i.test(text) || /\bdv\b/i.test(text)) return "Dolby Vision";
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

  function detectAudioLanguages(text) {
    var value = str(text);
    var known = [
      ["English", /\b(?:english|eng)\b/i], ["Japanese", /\b(?:japanese|jpn)\b/i],
      ["Spanish", /\b(?:spanish|spa)\b/i], ["French", /\b(?:french|fre|fra)\b/i],
      ["German", /\b(?:german|ger|deu)\b/i], ["Portuguese", /\b(?:portuguese|por)\b/i],
      ["Italian", /\b(?:italian|ita)\b/i], ["Korean", /\b(?:korean|kor)\b/i],
      ["Chinese", /\b(?:chinese|chi|zho)\b/i]
    ].filter(function (entry) { return entry[1].test(value); }).map(function (entry) { return entry[0]; });
    if (!known.length && /\b(?:dual|multi)[ ._-]*(?:audio|dub)\b/i.test(value)) known.push("Multiple");
    return known;
  }

  function fileIndexOf(raw) {
    if (!raw || raw.fileIdx == null || raw.fileIdx === "") return null;
    var value = Number(raw && raw.fileIdx);
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  function detectPack(text) {
    return /\b(?:complete|batch|season[ ._-]*pack|series[ ._-]*pack|collection)\b/i.test(text) ||
      /\bS\d{1,3}\s*[-–]\s*S?\d{1,3}\b/i.test(text) ||
      /\bE\d{1,4}\s*[-–]\s*E?\d{1,4}\b/i.test(text) ||
      /\bepisodes?\s*\d{1,4}\s*[-–]\s*\d{1,4}\b/i.test(text);
  }

  /** Conservatively parse only explicit episode markers, never bare numbers. */
  function episodeReference(text) {
    var value = str(text);
    var match = value.match(/\bS(\d{1,3})[ ._-]*E(\d{1,4})(?:v\d+)?\b/i) ||
      value.match(/\b(\d{1,3})x(\d{1,4})(?:v\d+)?\b/i);
    if (match) return { season: Number(match[1]), episode: Number(match[2]) };
    match = value.match(/\b(?:EP?|Episode)[ ._:-]*(\d{1,4})(?:v\d+)?\b/i);
    if (!match) match = value.match(/(?:^|\s)-\s*(\d{1,4})(?:v\d+)?(?=\s|[.\[_-]|$)/i);
    return match ? { season: null, episode: Number(match[1]) } : null;
  }

  function selectedEpisode(options) {
    var video = options && options.video;
    if (!video || typeof video !== "object") return null;
    var season = Number(video.season);
    var episode = Number(video.episode);
    if (!Number.isFinite(episode) || episode <= 0) return null;
    return { season: Number.isFinite(season) ? season : null, episode: episode };
  }

  function seriesIdentity(raw, hints, text, options) {
    var selected = selectedEpisode(options);
    var reference = episodeReference(text);
    var pack = detectPack(text);
    var fileIdx = fileIndexOf(raw);
    var status = "unknown";

    if (selected && reference) {
      var seasonMatches = reference.season === null || selected.season === null || reference.season === selected.season;
      status = seasonMatches && reference.episode === selected.episode ? "match" : "mismatch";
    } else if (selected && pack && raw.infoHash && fileIdx === null) {
      status = "ambiguous-pack";
    } else if (selected && pack && fileIdx !== null) {
      status = "pack-file";
    }

    return {
      fileIdx: fileIdx,
      filename: str(hints.filename),
      bingeGroup: str(hints.bingeGroup),
      pack: pack,
      episodeReference: reference,
      episodeStatus: status
    };
  }

  function identityKey(stream) {
    if (!stream) return "";
    var locator = stream.url || stream.ytId || stream.externalUrl || stream.infoHash || "";
    var filePart = stream.fileIdx === null || stream.fileIdx === undefined ? "" : ":file=" + stream.fileIdx;
    return "s" + stream.index + ":" + locator + filePart;
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

    // A provider's `name` is often just a debrid service label. The release title or
    // filename is the identity a viewer needs in order to choose a source.
    var title = str(raw.title || hints.filename || raw.name).trim();
    var sourceName = str(raw.name).trim();
    var description = str(raw.description).trim();
    var text = [raw.name, raw.title, raw.description, hints.filename].map(str).join(" ");
    var identity = seriesIdentity(raw, hints, text, options);

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
      addonOrder: Number.isFinite(raw._addonOrder) ? raw._addonOrder : Number.isFinite(options.addonOrder) ? options.addonOrder : 0,
      kind: kind,
      url: parsed && isSafeUrl(parsed) ? parsed.href : str(raw.url),
      urlSafe: raw.url ? isSafeUrl(parsed) : true,
      urlProtocol: parsed ? parsed.protocol : "",
      ytId: str(raw.ytId),
      externalUrl: externalParsed ? externalParsed.href : str(raw.externalUrl),
      externalSafe: raw.externalUrl ? isSafeUrl(externalParsed) : false,
      infoHash: str(raw.infoHash),
      fileIdx: identity.fileIdx,
      bingeGroup: identity.bingeGroup,
      title: title || (kind === KIND.UNKNOWN ? "Unknown source" : kind.toUpperCase() + " stream"),
      sourceName: sourceName,
      description: description,
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
        audioLanguages: detectAudioLanguages(text),
        sizeBytes: sizeBytes,
        sizeText: formatSize(sizeBytes),
        cached: detectCached(text),
        live: detectLive(raw, text),
        audioOnly: AUDIO_CONTAINERS.indexOf(container) !== -1,
        filename: identity.filename,
        pack: identity.pack,
        episodeReference: identity.episodeReference,
        episodeStatus: identity.episodeStatus,
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
        addonOrder: options.addonOrder,
        video: options.video,
        metaType: options.metaType
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
      mse: given.mse === true,
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
    // hls.js needs Media Source Extensions. Without them the only HLS path is
    // the browser's own, which is why `hlsSupported` folds both together.
    var mse = typeof w.MediaSource === "function" || typeof w.ManagedMediaSource === "function";
    return capabilities({
      pageProtocol: (w.location && w.location.protocol) || "https:",
      canPlayType: canPlayType,
      nativeHls: nativeHls,
      mse: mse,
      hlsSupported: options.hls === false || !mse ? nativeHls : true,
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
      return result(STATE.PROBABLY_READY, 0.2);
    }

    if (facts.container === "MKV" || facts.container === "AVI") {
      reasons.push(reason("container", facts.container + " playback depends on its codecs and this device. You can try it."));
      return result(STATE.PROBABLY_READY, 0.2);
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
      reasons.push(reason("cannot-play", "The browser predicts limited support for " + (facts.codec || facts.container) + ". You can still try it."));
      return result(STATE.PROBABLY_READY, 0.2);
    }

    if (facts.codec === "HEVC" || facts.hdr === "Dolby Vision") {
      reasons.push(reason("device-codec", (facts.hdr === "Dolby Vision" ? "Dolby Vision" : "HEVC") + " support depends on the device."));
      return result(STATE.PROBABLY_READY, 0.45);
    }

    reasons.push(reason("unverified", "Container not declared, so playback is unconfirmed."));
    return result(STATE.PROBABLY_READY, 0.5);
  }

  /**
   * The workload a source actually represents. Probing every entry as 1080p
   * would ask the device the wrong question: a phone can report 1080p VP9
   * smooth while being unable to sustain 3840x2160, and the answer would then
   * be used to upgrade the 4K entry.
   *
   * Bitrates are conservative per-resolution estimates. An add-on gives a file
   * size but no duration, so a real bitrate cannot be derived; guessing low
   * would make the probe answer "smooth" too easily, which is the failure
   * this is guarding against.
   */
  var WORKLOAD = {
    "2160p": { width: 3840, height: 2160, bitrate: 25000000 },
    "1080p": { width: 1920, height: 1080, bitrate: 8000000 },
    "720p": { width: 1280, height: 720, bitrate: 4000000 },
    "480p": { width: 854, height: 480, bitrate: 2000000 },
    "360p": { width: 640, height: 360, bitrate: 1000000 }
  };

  function workloadFor(stream) {
    return WORKLOAD[stream.facts.resolution] || null;
  }

  /**
   * Optional async refinement using MediaCapabilities. Only candidates with a
   * reliable content type *and* a known resolution are probed, and only the
   * first `limit` of them, so this never becomes a broad scan. Failure leaves
   * the sync verdict intact.
   */
  function refineWithDecodingInfo(evaluated, caps, options) {
    var probe = capabilities(caps);
    if (!probe.decodingInfo) return Promise.resolve(evaluated);
    var config = typeof options === "number" ? { limit: options } : options || {};
    var budget = Number.isFinite(config.limit) ? config.limit : 5;

    // Only probe a content type that actually names a codec. MediaCapabilities
    // cannot answer for a bare container type and reports it as unsupported,
    // which would hide a perfectly playable source.
    var pending = evaluated.slice(0, budget).filter(function (entry) {
      return (
        entry.stream.kind === KIND.DIRECT &&
        entry.evaluation.contentType &&
        entry.evaluation.contentType.indexOf("codecs=") !== -1 &&
        // No known resolution means no describable workload, and a probe we
        // cannot frame honestly is one we should not make.
        workloadFor(entry.stream) !== null
      );
    });

    var changed = false;

    return Promise.all(
      pending.map(function (entry) {
        return Promise.resolve()
          .then(function () {
            var workload = workloadFor(entry.stream);
            return probe.decodingInfo({
              type: "file",
              video: {
                contentType: entry.evaluation.contentType,
                width: workload.width,
                height: workload.height,
                bitrate: workload.bitrate,
                framerate: 24
              }
            });
          })
          .then(function (info) {
            if (!info || typeof info !== "object") return;
            if (info.supported === false) {
              entry.evaluation.state = STATE.PROBABLY_READY;
              entry.evaluation.label = "Try playback";
              entry.evaluation.playable = true;
              entry.evaluation.confidence = 0;
              entry.evaluation.reasons.unshift(reason("decoding-info", "The device reports it cannot decode this source."));
              changed = true;
            } else if (info.supported === true && info.smooth === true) {
              entry.evaluation.state = STATE.READY;
              entry.evaluation.label = STATE_LABEL[STATE.READY];
              entry.evaluation.playable = true;
              entry.evaluation.confidence = Math.max(entry.evaluation.confidence, 0.97);
              entry.evaluation.reasons.push(reason("decoding-info", "The device reports smooth decoding."));
              changed = true;
            }
          })
          .catch(function () {
            /* MediaCapabilities is advisory; keep the synchronous verdict. */
          });
      })
    ).then(function () {
      if (!changed) return evaluated;
      // A changed verdict changes the explanation, never the order: the list
      // the viewer is reading must not rearrange itself under their thumb.
      evaluated.forEach(refresh);
      return evaluated;
    });
  }

  /* ---------------------------------------------------------------- *
   * Presentation
   * ---------------------------------------------------------------- */

  /**
   * Prepare every candidate for display, in the order the add-on returned it.
   *
   * Astra deliberately does not rank, reorder or filter add-on results. An
   * add-on's configuration is where the owner expresses what they want back
   * and in what order; re-sorting it here would silently override that. What
   * this does add is a compatibility evaluation per source, because whether
   * this device can actually decode a source is something the add-on cannot
   * know and the viewer cannot see from a release name.
   */
  function prepare(streams, options) {
    var config = options || {};
    var caps = config.capabilities;

    return (Array.isArray(streams) ? streams : []).map(function (stream, index) {
      var normalized = stream && stream.facts ? stream : normalize(stream, { index: index, pageUrl: config.pageUrl });
      return refresh({ stream: normalized, evaluation: evaluate(normalized, caps) });
    });
  }

  /** Recompute the derived fields from the entry's current evaluation. */
  function refresh(entry) {
    entry.why = explain(entry);
    return entry;
  }

  /**
   * One short line for the UI. An unplayable source explains what is blocking
   * it; a playable one states how it will be delivered. Neither is a ranking
   * claim: nothing here says one source is better than another.
   */
  function explain(entry) {
    var first = entry.evaluation.reasons[0];
    return first ? first.text : entry.evaluation.label;
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
    workloadFor: workloadFor,
    evaluate: evaluate,
    refineWithDecodingInfo: refineWithDecodingInfo,
    prepare: prepare,
    explain: explain,
    refresh: refresh,
    identityKey: identityKey,
    episodeReference: episodeReference,
    detectPack: detectPack,
    tagsFor: tagsFor,
    formatSize: formatSize
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
