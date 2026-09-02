/**
 * Astra subtitle handling.
 *
 * Add-ons return subtitle lists of wildly varying quality: duplicates across
 * providers, missing languages, SRT served as .txt. This module normalizes and
 * de-duplicates them, converts SRT to VTT robustly, and hands every generated
 * object URL to a resource scope so cleanup revokes it.
 *
 * A track marked `inline` is fetched and re-attached as a blob even when it is
 * already WebVTT. That is not a conversion: it is the only way to attach a
 * cross-origin caption file, because a `<track>` load is a CORS request and
 * the media element cannot be put in CORS mode without breaking the direct
 * progressive video loads that must stay outside it.
 *
 * A subtitle failure is never allowed to fail video playback: every step is
 * individually guarded and simply yields fewer tracks.
 */
(function (global) {
  "use strict";

  var MAX_TRACKS = 24;

  var LANGUAGE_NAMES = {
    en: "English", eng: "English", es: "Spanish", spa: "Spanish", fr: "French", fre: "French",
    fra: "French", de: "German", ger: "German", deu: "German", it: "Italian", ita: "Italian",
    pt: "Portuguese", por: "Portuguese", nl: "Dutch", dut: "Dutch", nld: "Dutch", sv: "Swedish",
    swe: "Swedish", no: "Norwegian", nor: "Norwegian", da: "Danish", dan: "Danish", fi: "Finnish",
    fin: "Finnish", pl: "Polish", pol: "Polish", ru: "Russian", rus: "Russian", uk: "Ukrainian",
    ukr: "Ukrainian", cs: "Czech", cze: "Czech", tr: "Turkish", tur: "Turkish", ar: "Arabic",
    ara: "Arabic", he: "Hebrew", heb: "Hebrew", hi: "Hindi", hin: "Hindi", ja: "Japanese",
    jpn: "Japanese", ko: "Korean", kor: "Korean", zh: "Chinese", chi: "Chinese", zho: "Chinese",
    th: "Thai", tha: "Thai", vi: "Vietnamese", vie: "Vietnamese", id: "Indonesian", ind: "Indonesian",
    ro: "Romanian", rum: "Romanian", el: "Greek", gre: "Greek", hu: "Hungarian", hun: "Hungarian"
  };

  // Three-letter codes normalized to the two-letter form used for `srclang`.
  var ALIAS = {
    eng: "en", spa: "es", fre: "fr", fra: "fr", ger: "de", deu: "de", ita: "it", por: "pt",
    dut: "nl", nld: "nl", swe: "sv", nor: "no", dan: "da", fin: "fi", pol: "pl", rus: "ru",
    ukr: "uk", cze: "cs", tur: "tr", ara: "ar", heb: "he", hin: "hi", jpn: "ja", kor: "ko",
    chi: "zh", zho: "zh", tha: "th", vie: "vi", ind: "id", rum: "ro", gre: "el", hun: "hu"
  };

  function str(value) {
    return value == null ? "" : String(value);
  }

  function normalizeLang(value) {
    var raw = str(value).trim().toLowerCase();
    if (!raw) return "";
    var base = raw.split(/[-_]/)[0];
    return ALIAS[base] || base;
  }

  function languageName(code) {
    var normalized = normalizeLang(code);
    return LANGUAGE_NAMES[normalized] || (normalized ? normalized.toUpperCase() : "Unknown");
  }

  function safeUrl(value, base) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      var parsed = new URL(value, base || undefined);
      return ["http:", "https:", "blob:"].indexOf(parsed.protocol) === -1 ? "" : parsed.href;
    } catch (error) {
      return "";
    }
  }

  /**
   * Normalize and de-duplicate a subtitle list. Duplicates are collapsed by
   * URL first, then by language+label, which is what actually repeats when
   * several add-ons wrap the same OpenSubtitles entry.
   */
  function normalizeTracks(list, options) {
    var config = options || {};
    var seenUrls = {};
    var seenLabels = {};
    var out = [];

    (Array.isArray(list) ? list : []).forEach(function (item) {
      if (!item || typeof item !== "object") return;
      var url = safeUrl(item.url, config.pageUrl);
      if (!url) return;
      if (seenUrls[url]) return;
      seenUrls[url] = true;

      var lang = normalizeLang(item.lang || item.language || item.srclang);
      var name = languageName(lang);
      var extra = str(item.label || item.name || item.id).trim();
      // Keep a provider suffix only when it adds information.
      var label = extra && extra.toLowerCase() !== name.toLowerCase() ? name + " · " + extra : name;

      var labelKey = (lang || "?") + "|" + label.toLowerCase();
      if (seenLabels[labelKey]) return;
      seenLabels[labelKey] = true;

      out.push({
        id: "sub" + out.length,
        url: url,
        lang: lang,
        label: label,
        language: name,
        source: str(item._addonName || config.addonName),
        isSrt: /\.srt(?:$|[?#])/i.test(url) || str(item.format).toLowerCase() === "srt",
        // A `<track src>` is fetched in CORS mode. The media element carries no
        // `crossorigin` attribute, because setting one would break the direct
        // progressive video loads that need to stay non-CORS, so a cross-origin
        // caption file has to be fetched by hand and attached as a blob.
        inline: item.inline === true
      });
    });

    return out.slice(0, MAX_TRACKS);
  }

  var TIMESTAMP = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/g;

  /**
   * Convert SRT to WebVTT. Tolerates BOMs, CRLF, missing cue numbers, comma or
   * dot decimals, single-digit hours, and text that is already VTT.
   */
  function srtToVtt(input) {
    var text = str(input).replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
    if (!text) return "";
    if (/^WEBVTT/.test(text)) return text;

    var body = text
      .split(/\n{2,}/)
      .map(function (block) {
        var lines = block.split("\n");
        // Drop a leading cue number; VTT does not need it.
        if (lines.length > 1 && /^\d+$/.test(lines[0].trim()) && lines[1].indexOf("-->") !== -1) {
          lines = lines.slice(1);
        }
        return lines
          .map(function (line) {
            if (line.indexOf("-->") === -1) return line;
            return line.replace(TIMESTAMP, function (_match, h, m, s, ms) {
              var hours = h.length === 1 ? "0" + h : h;
              var millis = (ms + "00").slice(0, 3);
              return hours + ":" + m + ":" + s + "." + millis;
            });
          })
          .join("\n");
      })
      .filter(function (block) {
        return block.trim().length > 0;
      })
      .join("\n\n");

    return "WEBVTT\n\n" + body;
  }

  /**
   * Choose which track should start enabled. Returns null when subtitles are
   * off or no track matches the preferred language.
   */
  function pickDefault(tracks, settings) {
    var owner = settings || {};
    if (!owner.subtitlesDefault) return null;
    var wanted = normalizeLang(owner.subtitleLanguage);
    if (!wanted) return null;
    for (var i = 0; i < tracks.length; i += 1) {
      if (tracks[i].lang === wanted) return tracks[i];
    }
    return null;
  }

  /**
   * Fetch, convert if needed, and attach tracks to a media element.
   *
   * Every generated object URL goes through `scope.objectUrl`, so closing the
   * player revokes them. Any single track that fails is skipped; the returned
   * promise always resolves, never rejects, because losing subtitles must not
   * lose the video.
   */
  function attachTracks(config) {
    var options = config || {};
    var media = options.media;
    var scope = options.scope;
    var tracks = Array.isArray(options.tracks) ? options.tracks : [];
    var fetchImpl = options.fetch || (typeof global.fetch === "function" ? global.fetch.bind(global) : null);
    var createObjectURL =
      options.createObjectURL ||
      function (blob) {
        return global.URL.createObjectURL(blob);
      };
    var BlobImpl = options.Blob || global.Blob;
    var isCancelled = typeof options.isCancelled === "function" ? options.isCancelled : function () { return false; };
    var preferred = pickDefault(tracks, options.settings);

    if (!media || !scope || !tracks.length) return Promise.resolve([]);

    return Promise.all(
      tracks.map(function (track) {
        if (!track.isSrt && !track.inline) return Promise.resolve({ track: track, src: track.url });
        if (!fetchImpl) return Promise.resolve(null);
        return Promise.resolve()
          .then(function () {
            return fetchImpl(track.url);
          })
          .then(function (response) {
            if (!response || response.ok === false) throw new Error("subtitle fetch failed");
            return response.text();
          })
          .then(function (body) {
            var vtt = srtToVtt(body);
            if (!vtt) return null;
            var url = createObjectURL(new BlobImpl([vtt], { type: "text/vtt" }));
            return { track: track, src: scope.objectUrl(url) };
          })
          .catch(function () {
            // One bad subtitle must not fail the attach, let alone playback.
            return null;
          });
      })
    ).then(function (results) {
      var attached = [];
      results.forEach(function (result) {
        if (!result || isCancelled() || scope.disposed) return;
        try {
          var element = media.ownerDocument.createElement("track");
          element.kind = "subtitles";
          element.label = result.track.label;
          if (result.track.lang) element.srclang = result.track.lang;
          element.src = result.src;
          if (preferred && result.track === preferred) element.default = true;
          media.appendChild(element);
          scope.onDispose(function () {
            if (element.parentNode) element.parentNode.removeChild(element);
          });
          attached.push({ track: result.track, element: element });
        } catch (error) {
          /* a track that will not attach is simply not offered */
        }
      });
      return attached;
    });
  }

  function setMode(track, mode) {
    try {
      track.mode = mode;
    } catch (error) {
      /* some browsers reject mode changes on unloaded tracks */
    }
  }

  function disableAll(media) {
    for (var i = 0; i < media.textTracks.length; i += 1) setMode(media.textTracks[i], "disabled");
  }

  /**
   * Enable the first track of a language, or turn all of them off.
   *
   * Only the first match is shown: two providers can supply the same language,
   * and enabling both renders overlapping captions.
   */
  function selectTextTrack(media, lang) {
    if (!media || !media.textTracks) return false;
    disableAll(media);
    var wanted = normalizeLang(lang);
    if (!wanted) return false;
    for (var i = 0; i < media.textTracks.length; i += 1) {
      if (normalizeLang(media.textTracks[i].language) === wanted) {
        setMode(media.textTracks[i], "showing");
        return true;
      }
    }
    return false;
  }

  /**
   * Enable exactly one attached track by its stable id, so two same-language
   * providers stay individually selectable. Passing no id turns everything off.
   */
  function selectAttachedTrack(media, attached, id) {
    if (!media || !media.textTracks) return false;
    disableAll(media);
    if (id == null || id === "") return false;
    var wanted = String(id);
    var list = attached || [];
    for (var i = 0; i < list.length; i += 1) {
      var entry = list[i];
      if (!entry || !entry.track || String(entry.track.id) !== wanted) continue;
      var textTrack = entry.element && entry.element.track;
      if (!textTrack) return false;
      setMode(textTrack, "showing");
      return true;
    }
    return false;
  }

  global.AstraPlayback = global.AstraPlayback || {};
  global.AstraPlayback.subtitles = {
    MAX_TRACKS: MAX_TRACKS,
    normalizeLang: normalizeLang,
    languageName: languageName,
    normalizeTracks: normalizeTracks,
    srtToVtt: srtToVtt,
    pickDefault: pickDefault,
    attachTracks: attachTracks,
    selectTextTrack: selectTextTrack,
    selectAttachedTrack: selectAttachedTrack
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
