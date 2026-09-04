/**
 * The Invidious API client.
 *
 * Everything an Invidious instance returns is untrusted external data: it is
 * relayed from YouTube, it is shaped by whoever operates that server, and it
 * arrives as free text. So nothing here is passed through - every field is
 * re-derived into a small, typed record with validated ids, validated URLs and
 * plain text only. `descriptionHtml` is deliberately never read.
 *
 * On top of that this owns the request economics the UI depends on: a short
 * TTL cache, in-flight de-duplication with reference-counted cancellation, and
 * abort support, so a debounced search does not leave a queue of dead requests
 * behind it.
 *
 * Loaded as a classic browser script and through node:vm in the tests.
 */
(function (global) {
  "use strict";

  var VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
  var CHANNEL_ID = /^[A-Za-z0-9_-]{2,64}$/;
  var PLAYLIST_ID = /^[A-Za-z0-9_-]{2,64}$/;
  var MAX_RESULTS = 40;
  var MAX_TEXT = 5000;
  var MAX_CACHE_ENTRIES = 80;

  function str(value, limit) {
    if (value == null) return "";
    return String(value).slice(0, limit || MAX_TEXT);
  }

  /**
   * Strip what a title or description has no business carrying: control
   * characters, the soft hyphen, bidi overrides and zero-width marks. None of
   * them render as anything; what they can do is fake layout or hide what a
   * card actually says. Tabs and newlines survive, because a description is
   * genuinely multi-line.
   */
  function plain(value, limit) {
    var input = str(value, limit);
    var out = "";
    for (var i = 0; i < input.length; i += 1) {
      var code = input.charCodeAt(i);
      if (code !== 0x09 && code !== 0x0a && code < 0x20) continue;
      if (code >= 0x7f && code <= 0x9f) continue;
      if (code === 0xad || code === 0xfeff) continue;
      if (code >= 0x200b && code <= 0x200f) continue;
      if (code === 0x2028 || code === 0x2029) continue;
      if (code >= 0x202a && code <= 0x202e) continue;
      if (code >= 0x2066 && code <= 0x2069) continue;
      out += input.charAt(i);
    }
    return out.trim();
  }

  function count(value) {
    var number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  }

  function seconds(value) {
    var number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }

  function isVideoId(value) {
    return VIDEO_ID.test(str(value, 20));
  }

  /** The stable Astra id for a YouTube video: `youtube:VIDEO_ID`. */
  function contentKey(videoId) {
    return isVideoId(videoId) ? "youtube:" + videoId : "";
  }

  /** Read a video id back out of an Astra content key. */
  function videoIdFromKey(key) {
    var match = /^youtube:([A-Za-z0-9_-]{11})$/.exec(str(key, 40));
    return match ? match[1] : "";
  }

  /**
   * Recognise a pasted YouTube link so the search box accepts one. Only the
   * shapes that unambiguously name a single video are honoured.
   */
  function videoIdFromInput(value) {
    var raw = str(value, 300).trim();
    if (!raw) return "";
    if (isVideoId(raw)) return raw;
    var direct = videoIdFromKey(raw);
    if (direct) return direct;
    var parsed;
    try {
      parsed = new URL(raw);
    } catch (error) {
      return "";
    }
    var host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      var short = parsed.pathname.slice(1);
      return isVideoId(short) ? short : "";
    }
    if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "music.youtube.com") return "";
    var query = parsed.searchParams.get("v");
    if (isVideoId(query)) return query;
    var path = /^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/.exec(parsed.pathname);
    return path ? path[1] : "";
  }

  /**
   * Resolve an image URL an instance returned. Absolute https wins; a
   * root-relative path is resolved against the instance, which is how an
   * instance configured to proxy images reports them. Everything else is
   * dropped rather than guessed at.
   */
  function imageUrl(value, instance) {
    var raw = str(value, 600).trim();
    if (!raw) return "";
    if (raw.indexOf("//") === 0) raw = "https:" + raw;
    var parsed;
    try {
      parsed = new URL(raw, instance || undefined);
    } catch (error) {
      return "";
    }
    return parsed.protocol === "https:" ? parsed.href : "";
  }

  function pickThumbnail(list, instance, wanted) {
    var usable = (Array.isArray(list) ? list : [])
      .map(function (item) {
        return {
          url: imageUrl(item && item.url, instance),
          width: count(item && item.width),
          quality: str(item && item.quality, 40)
        };
      })
      .filter(function (item) {
        return !!item.url;
      });
    if (!usable.length) return "";
    var named = usable.filter(function (item) {
      return wanted && item.quality === wanted;
    });
    if (named.length) return named[0].url;
    // Otherwise the widest one that is still sensible for a phone card.
    var sorted = usable.slice().sort(function (a, b) { return b.width - a.width; });
    var capped = sorted.filter(function (item) { return item.width && item.width <= 1280; });
    return (capped[0] || sorted[0]).url;
  }

  /**
   * A thumbnail is optional, but a card with no artwork looks broken. When an
   * instance returns nothing usable, fall back to that instance's own image
   * path rather than naming a Google host in our source.
   */
  function thumbnailFallback(videoId, instance) {
    if (!isVideoId(videoId) || !instance) return "";
    return instance + "/vi/" + videoId + "/mqdefault.jpg";
  }

  function normalizeVideo(raw, instance) {
    if (!raw || typeof raw !== "object") return null;
    var videoId = str(raw.videoId, 20);
    if (!isVideoId(videoId)) return null;
    var thumbnail = pickThumbnail(raw.videoThumbnails, instance, "medium") ||
      thumbnailFallback(videoId, instance);
    return {
      kind: "video",
      videoId: videoId,
      key: contentKey(videoId),
      title: plain(raw.title, 300) || "Untitled video",
      author: plain(raw.author, 120),
      authorId: CHANNEL_ID.test(str(raw.authorId, 64)) ? str(raw.authorId, 64) : "",
      description: plain(raw.description, 5000),
      lengthSeconds: seconds(raw.lengthSeconds),
      viewCount: count(raw.viewCount),
      published: count(raw.published),
      publishedText: plain(raw.publishedText, 60),
      live: raw.liveNow === true,
      upcoming: raw.isUpcoming === true,
      thumbnail: thumbnail,
      poster: pickThumbnail(raw.videoThumbnails, instance, "maxres") || thumbnail
    };
  }

  function normalizeChannel(raw, instance) {
    if (!raw || typeof raw !== "object") return null;
    var authorId = str(raw.authorId, 64);
    if (!CHANNEL_ID.test(authorId)) return null;
    return {
      kind: "channel",
      authorId: authorId,
      key: "youtube-channel:" + authorId,
      title: plain(raw.author, 120) || "Channel",
      description: plain(raw.description, 2000),
      subscribers: count(raw.subCount),
      videoCount: count(raw.videoCount),
      thumbnail: pickThumbnail(raw.authorThumbnails, instance, "")
    };
  }

  function normalizePlaylist(raw, instance) {
    if (!raw || typeof raw !== "object") return null;
    var playlistId = str(raw.playlistId, 64);
    if (!PLAYLIST_ID.test(playlistId)) return null;
    var videos = (Array.isArray(raw.videos) ? raw.videos : [])
      .map(function (item) { return normalizeVideo(item, instance); })
      .filter(Boolean);
    return {
      kind: "playlist",
      playlistId: playlistId,
      key: "youtube-playlist:" + playlistId,
      title: plain(raw.title, 300) || "Playlist",
      author: plain(raw.author, 120),
      videoCount: count(raw.videoCount) || videos.length,
      thumbnail: imageUrl(raw.playlistThumbnail, instance) || (videos[0] ? videos[0].thumbnail : ""),
      videos: videos
    };
  }

  function normalizeResult(raw, instance) {
    if (!raw || typeof raw !== "object") return null;
    var type = str(raw.type, 20);
    if (type === "channel") return normalizeChannel(raw, instance);
    if (type === "playlist") return normalizePlaylist(raw, instance);
    // Anything else carrying a video id is treated as a video, which is how
    // shorts and unlabelled entries arrive from some instances.
    return normalizeVideo(raw, instance);
  }

  /** A URL an instance returned, kept only when it belongs to that instance. */
  function instanceUrl(value, instance) {
    var raw = str(value, 2000).trim();
    if (!raw || !instance) return "";
    var parsed;
    var base;
    try {
      parsed = new URL(raw, instance);
      base = new URL(instance);
    } catch (error) {
      return "";
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return parsed.origin === base.origin ? parsed.href : "";
  }

  /**
   * A playback URL from the API. Google's video hosts are the expected origin
   * here, so unlike `instanceUrl` this accepts any host - but it still refuses
   * anything that is not http(s), which is what keeps a `javascript:` or
   * `data:` payload out of a `<video src>`.
   */
  function mediaUrl(value) {
    var raw = str(value, 4000).trim();
    if (!raw) return "";
    var parsed;
    try {
      parsed = new URL(raw);
    } catch (error) {
      return "";
    }
    // This is YouTube's JSON control API, never an audio or video file. Some
    // failing public Piped servers have mislabeled it as a playable stream.
    if (/(^|\.)youtubei\.googleapis\.com$/i.test(parsed.hostname) || /\/youtubei\/v1\//i.test(parsed.pathname)) {
      return "";
    }
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
  }

  function normalizeFormat(raw, adaptive) {
    if (!raw || typeof raw !== "object") return null;
    var url = mediaUrl(raw.url);
    if (!url) return null;
    var type = plain(raw.type, 200);
    var mime = type.split(";")[0].trim().toLowerCase();
    if (!/^(?:video|audio)\//.test(mime)) return null;
    var codecMatch = /codecs\s*=\s*"?([^";]+)"?/i.exec(type);
    var codecs = codecMatch ? plain(codecMatch[1], 120) : "";
    var resolution = plain(raw.resolution || raw.qualityLabel, 20);
    var heightMatch = /(\d{3,4})p/.exec(resolution);
    return {
      itag: str(raw.itag, 10),
      url: url,
      mime: mime,
      codecs: codecs,
      contentType: codecs ? mime + '; codecs="' + codecs + '"' : mime,
      container: plain(raw.container, 20) || mime.split("/")[1] || "",
      quality: plain(raw.qualityLabel || raw.quality, 20),
      height: heightMatch ? Number(heightMatch[1]) : 0,
      fps: count(raw.fps),
      bitrate: count(raw.bitrate),
      clen: count(raw.clen || raw.size),
      audioQuality: plain(raw.audioQuality, 40),
      audioChannels: count(raw.audioChannels),
      adaptive: !!adaptive,
      audioOnly: mime.indexOf("audio/") === 0,
      videoOnly: !!adaptive && mime.indexOf("video/") === 0
    };
  }

  function normalizeCaptions(list, instance) {
    return (Array.isArray(list) ? list : [])
      .map(function (item) {
        if (!item || typeof item !== "object") return null;
        var url = instanceUrl(item.url, instance);
        if (!url) return null;
        return {
          url: url,
          lang: plain(item.languageCode || item.language_code, 20),
          label: plain(item.label, 120) || plain(item.languageCode, 20) || "Captions"
        };
      })
      .filter(Boolean)
      .slice(0, 24);
  }

  /**
   * The full video record. `instance` matters: manifest and caption URLs are
   * only trusted when they belong to the server that answered, and relative
   * URLs are resolved against it.
   */
  function normalizeVideoDetail(raw, instance) {
    var base = normalizeVideo(raw, instance);
    if (!base) return null;
    base.instance = instance;
    base.likeCount = count(raw.likeCount);
    base.subCountText = plain(raw.subCountText, 40);
    base.genre = plain(raw.genre, 60);
    base.dashUrl = instanceUrl(raw.dashUrl, instance);
    base.hlsUrl = instanceUrl(raw.hlsUrl, instance);
    base.formatStreams = (Array.isArray(raw.formatStreams) ? raw.formatStreams : [])
      .map(function (item) { return normalizeFormat(item, false); })
      .filter(Boolean);
    base.adaptiveFormats = (Array.isArray(raw.adaptiveFormats) ? raw.adaptiveFormats : [])
      .map(function (item) { return normalizeFormat(item, true); })
      .filter(Boolean);
    base.captions = normalizeCaptions(raw.captions, instance);
    base.recommended = (Array.isArray(raw.recommendedVideos) ? raw.recommendedVideos : [])
      .map(function (item) { return normalizeVideo(item, instance); })
      .filter(Boolean)
      .slice(0, 12);
    return base;
  }

  /* ------------------------------------------------------------------ *
   * Piped
   *
   * A second protocol, normalized into exactly the records above. Piped is
   * what a browser-only static site can actually use: its own frontend is a
   * separate-origin static app, so the API is CORS-enabled by design, and the
   * stream URLs it returns are already proxied by the instance - which means
   * they carry CORS headers and are not bound to the address that resolved
   * them.
   *
   * Because the output shape is identical, everything downstream - the
   * playback plan, the quality ladder, the picker, the player - is untouched
   * by the existence of a second backend.
   * ------------------------------------------------------------------ */

  /**
   * Piped returns a video description as HTML. Astra draws descriptions as
   * text, so the markup is removed rather than escaped: a viewer should see
   * the paragraph, not the tags that were around it.
   */
  function stripHtml(value) {
    var text = str(value, 20000)
      .replace(/<br\s*\/?>/gi, "\n")
      // Both ends of a paragraph are a break, or two paragraphs run together.
      .replace(/<\/?p[^>]*>/gi, "\n\n")
      .replace(/<[^>]*>/g, "");
    var entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
    return plain(
      text
        .replace(/&(#?[a-z0-9]+);/gi, function (match, name) {
          var key = String(name).toLowerCase();
          if (entities[key] !== undefined) return entities[key];
          var code = /^#(\d+)$/.exec(key);
          return code ? String.fromCharCode(Number(code[1])) : match;
        })
        .replace(/\n{3,}/g, "\n\n"),
      5000
    );
  }

  /** Piped names a video by its watch path rather than by a bare id. */
  function videoIdFromPipedUrl(value) {
    var raw = str(value, 300);
    var match = /[?&]v=([A-Za-z0-9_-]{11})\b/.exec(raw) || /^\/?([A-Za-z0-9_-]{11})$/.exec(raw);
    return match && isVideoId(match[1]) ? match[1] : "";
  }

  function pipedChannelId(value) {
    var match = /\/channel\/([A-Za-z0-9_-]{2,64})/.exec(str(value, 200));
    return match ? match[1] : "";
  }

  function normalizePipedVideo(raw, instance) {
    if (!raw || typeof raw !== "object") return null;
    var videoId = videoIdFromPipedUrl(raw.url) || str(raw.videoId, 20);
    if (!isVideoId(videoId)) return null;
    var thumbnail = imageUrl(raw.thumbnail || raw.thumbnailUrl, instance) || thumbnailFallback(videoId, instance);
    // Piped reports upload time in milliseconds; the record keeps seconds.
    var uploaded = count(raw.uploaded);
    return {
      kind: "video",
      videoId: videoId,
      key: contentKey(videoId),
      title: plain(raw.title || raw.name, 300) || "Untitled video",
      author: plain(raw.uploaderName || raw.uploader, 120),
      authorId: pipedChannelId(raw.uploaderUrl),
      description: stripHtml(raw.shortDescription || raw.description),
      lengthSeconds: seconds(raw.duration),
      viewCount: count(raw.views),
      published: uploaded > 1e11 ? Math.floor(uploaded / 1000) : uploaded,
      publishedText: plain(raw.uploadedDate || raw.uploadDate, 60),
      live: raw.livestream === true || seconds(raw.duration) === 0,
      upcoming: raw.isUpcoming === true,
      thumbnail: thumbnail,
      poster: thumbnail
    };
  }

  function normalizePipedChannel(raw, instance) {
    if (!raw || typeof raw !== "object") return null;
    var authorId = pipedChannelId(raw.url) || str(raw.id, 64);
    if (!CHANNEL_ID.test(authorId)) return null;
    return {
      kind: "channel",
      authorId: authorId,
      key: "youtube-channel:" + authorId,
      title: plain(raw.name || raw.uploaderName, 120) || "Channel",
      description: stripHtml(raw.description),
      subscribers: count(raw.subscribers),
      videoCount: count(raw.videos),
      thumbnail: imageUrl(raw.thumbnail || raw.avatarUrl, instance)
    };
  }

  function normalizePipedPlaylist(raw, instance) {
    if (!raw || typeof raw !== "object") return null;
    var match = /[?&]list=([A-Za-z0-9_-]{2,64})/.exec(str(raw.url, 200));
    var playlistId = match ? match[1] : str(raw.id, 64);
    if (!PLAYLIST_ID.test(playlistId)) return null;
    return {
      kind: "playlist",
      playlistId: playlistId,
      key: "youtube-playlist:" + playlistId,
      title: plain(raw.name || raw.title, 300) || "Playlist",
      author: plain(raw.uploaderName, 120),
      videoCount: count(raw.videos),
      thumbnail: imageUrl(raw.thumbnail, instance),
      videos: []
    };
  }

  function normalizePipedResult(raw, instance) {
    if (!raw || typeof raw !== "object") return null;
    var type = str(raw.type, 20);
    if (type === "channel") return normalizePipedChannel(raw, instance);
    if (type === "playlist") return normalizePipedPlaylist(raw, instance);
    return normalizePipedVideo(raw, instance);
  }

  /**
   * Piped splits what Invidious puts in one `type` string: a MIME type in
   * `mimeType` and a codec in `codec`. The codec is only appended when it is
   * actually present, because a bare container type is what makes Chrome
   * answer "maybe" instead of refusing outright.
   */
  function normalizePipedFormat(raw, adaptive) {
    if (!raw || typeof raw !== "object") return null;
    var url = mediaUrl(raw.url);
    if (!url) return null;
    var mime = plain(raw.mimeType, 60).split(";")[0].trim().toLowerCase();
    if (!/^(?:video|audio)\//.test(mime)) return null;
    var codecs = plain(raw.codec, 120);
    var quality = plain(raw.quality, 20);
    var heightMatch = /(\d{3,4})p/.exec(quality);
    var height = count(raw.height) || (heightMatch ? Number(heightMatch[1]) : 0);
    var audioOnly = mime.indexOf("audio/") === 0;
    return {
      itag: str(raw.itag, 10),
      url: url,
      mime: mime,
      codecs: codecs,
      contentType: codecs ? mime + '; codecs="' + codecs + '"' : mime,
      container: plain(raw.format, 20).toLowerCase().indexOf("webm") !== -1 ? "webm" : mime.split("/")[1] || "",
      quality: quality,
      height: audioOnly ? 0 : height,
      fps: count(raw.fps),
      bitrate: count(raw.bitrate),
      clen: count(raw.contentLength),
      audioQuality: plain(raw.audioTrackName, 40),
      audioChannels: 0,
      adaptive: !!adaptive,
      audioOnly: audioOnly,
      videoOnly: !!adaptive && !audioOnly
    };
  }

  function normalizePipedCaptions(list, instance) {
    return (Array.isArray(list) ? list : [])
      .map(function (item) {
        if (!item || typeof item !== "object") return null;
        var url = instanceUrl(item.url, instance);
        if (!url) return null;
        var lang = plain(item.code, 20);
        return {
          url: url,
          lang: lang,
          label: plain(item.name, 120) || lang || "Captions"
        };
      })
      .filter(Boolean)
      .slice(0, 24);
  }

  /**
   * The full Piped video record. `/streams` does not echo the id back, so the
   * caller's id is what identifies it.
   */
  function normalizePipedDetail(raw, instance, videoId) {
    if (!raw || typeof raw !== "object" || !isVideoId(videoId)) return null;
    var base = normalizePipedVideo({ url: "?v=" + videoId, videoId: videoId }, instance);
    if (!base) return null;
    base.api = "piped";

    var video = Array.isArray(raw.videoStreams) ? raw.videoStreams : [];
    var audio = Array.isArray(raw.audioStreams) ? raw.audioStreams : [];

    base.title = plain(raw.title, 300) || "Untitled video";
    base.author = plain(raw.uploader, 120);
    base.authorId = pipedChannelId(raw.uploaderUrl);
    base.description = stripHtml(raw.description);
    base.lengthSeconds = seconds(raw.duration);
    base.viewCount = count(raw.views);
    base.publishedText = plain(raw.uploadDate, 60);
    base.live = raw.livestream === true;
    base.thumbnail = imageUrl(raw.thumbnailUrl, instance) || base.thumbnail;
    base.poster = base.thumbnail;
    base.instance = instance;
    base.likeCount = count(raw.likes);
    base.subCountText = "";
    base.genre = plain(raw.category, 60);
    base.dashUrl = instanceUrl(raw.dash, instance);
    base.hlsUrl = instanceUrl(raw.hls, instance);
    // A muxed entry is the one thing a plain <video src> can play on its own.
    base.formatStreams = video
      .filter(function (item) { return item && item.videoOnly === false; })
      .map(function (item) { return normalizePipedFormat(item, false); })
      .filter(Boolean);
    base.adaptiveFormats = video
      .filter(function (item) { return item && item.videoOnly === true; })
      .map(function (item) { return normalizePipedFormat(item, true); })
      .filter(Boolean)
      .concat(
        audio.map(function (item) { return normalizePipedFormat(item, true); }).filter(Boolean)
      );
    base.captions = normalizePipedCaptions(raw.subtitles, instance);
    base.recommended = (Array.isArray(raw.relatedStreams) ? raw.relatedStreams : [])
      .map(function (item) { return normalizePipedVideo(item, instance); })
      .filter(Boolean)
      .slice(0, 12);
    return base;
  }

  /* ------------------------------------------------------------------ *
   * Client
   * ------------------------------------------------------------------ */

  /**
   * A tiny TTL cache, bounded by entry count. An Invidious video record with
   * every format in it is not small, and a long session should not accumulate
   * them.
   */
  function createCache(ttl, now) {
    var entries = new Map();
    return {
      get: function (key) {
        var entry = entries.get(key);
        if (!entry) return undefined;
        if (entry.expires <= now()) {
          entries.delete(key);
          return undefined;
        }
        // Refresh insertion order so the least recently used is evicted.
        entries.delete(key);
        entries.set(key, entry);
        return entry.value;
      },
      set: function (key, value) {
        if (!ttl) return value;
        entries.delete(key);
        entries.set(key, { value: value, expires: now() + ttl });
        while (entries.size > MAX_CACHE_ENTRIES) {
          entries.delete(entries.keys().next().value);
        }
        return value;
      },
      drop: function (key) {
        entries.delete(key);
      },
      clear: function () {
        entries.clear();
      },
      get size() {
        return entries.size;
      }
    };
  }

  function createClient(options) {
    var settings = options || {};
    var manager = settings.manager;
    var playbackManager = settings.playbackManager || manager;
    var config = settings.config;
    var now = typeof settings.now === "function" ? settings.now : function () { return Date.now(); };
    var Controller = settings.AbortController || global.AbortController;
    var errorFor = global.AstraYouTube.instances.providerError;
    var cache = createCache(config.cacheTtl, now);
    var inflight = new Map();

    /**
     * Share one network request between identical concurrent callers.
     *
     * Each caller holds a reference; abandoning one only aborts the shared
     * request when the last caller lets go, so a cancelled keystroke cannot
     * kill a request another part of the UI is still waiting for.
     */
    function run(key, describe, signal, requestManager) {
      var cached = cache.get(key);
      if (cached !== undefined) return Promise.resolve({ cached: true, value: cached });

      var entry = inflight.get(key);
      if (!entry) {
        var controller = Controller ? new Controller() : null;
        entry = { controller: controller, refs: 0, promise: null };
        entry.promise = (requestManager || manager)
          .request(describe, {
            signal: controller ? controller.signal : undefined
          })
          .then(
            function (result) {
              inflight.delete(key);
              return result;
            },
            function (error) {
              inflight.delete(key);
              throw error;
            }
          );
        inflight.set(key, entry);
      }

      var shared = entry;
      shared.refs += 1;

      return new Promise(function (resolve, reject) {
        var settled = false;

        function detach() {
          if (settled) return false;
          settled = true;
          shared.refs -= 1;
          if (signal) signal.removeEventListener("abort", onAbort);
          return true;
        }

        function onAbort() {
          if (!detach()) return;
          // Only the last caller letting go may stop the shared request.
          if (shared.refs <= 0 && shared.controller) {
            try {
              shared.controller.abort();
            } catch (error) {
              /* an already-aborted controller is fine */
            }
          }
          reject(errorFor("aborted", "The request was cancelled."));
        }

        if (signal) {
          if (signal.aborted) return onAbort();
          signal.addEventListener("abort", onAbort);
        }

        shared.promise.then(
          function (result) {
            if (detach()) resolve({ cached: false, value: result });
          },
          function (error) {
            if (detach()) reject(error);
          }
        );
      });
    }

    function isArrayBody(body) {
      return Array.isArray(body);
    }

    function isVideoBody(body) {
      return !!body && typeof body === "object" && isVideoId(body.videoId);
    }

    function isPipedSearchBody(body) {
      return !!body && typeof body === "object" && Array.isArray(body.items);
    }

    /**
     * A Piped `/streams` body proves itself by carrying streams. An instance
     * that answers with a title and nothing playable has not resolved the
     * video, and treating that as success would hand the player an empty plan.
     */
    function isPipedStreamsBody(body) {
      if (!body || typeof body !== "object") return false;
      return Array.isArray(body.videoStreams) && (body.videoStreams.length > 0 || Array.isArray(body.audioStreams));
    }

    var PIPED_FILTER = { video: "videos", channel: "channels", playlist: "playlists", all: "all" };

    /**
     * Search YouTube. The caller picks the result type, because the browse
     * surface and the search surface want different things.
     */
    function search(query, options) {
      var request = options || {};
      var wanted = plain(query, 200);
      if (!wanted) return Promise.resolve({ items: [], instance: "", query: "" });
      var type = ["video", "channel", "playlist", "all"].indexOf(request.type) === -1 ? "video" : request.type;
      var page = Math.max(1, Math.min(5, Number(request.page) || 1));
      var key = "search|" + type + "|" + page + "|" + wanted.toLowerCase();

      return run(
        key,
        function (record) {
          if (record.api === "piped") {
            return {
              path: "/search",
              params: { q: wanted, filter: PIPED_FILTER[type] || "videos" },
              validate: isPipedSearchBody
            };
          }
          return {
            path: "/api/v1/search",
            params: { q: wanted, type: type, page: page, sort_by: "relevance" },
            validate: isArrayBody
          };
        },
        request.signal
      ).then(function (outcome) {
        if (outcome.cached) return outcome.value;
        var result = outcome.value;
        var piped = result.api === "piped";
        var rows = piped ? result.data.items : result.data;
        var payload = {
          items: rows
            .map(function (item) {
              return piped ? normalizePipedResult(item, result.instance) : normalizeResult(item, result.instance);
            })
            .filter(Boolean)
            .slice(0, MAX_RESULTS),
          instance: result.instance,
          api: result.api,
          query: wanted,
          latency: result.latency
        };
        cache.set(key, payload);
        return payload;
      });
    }

    /** Trending gives the browse surface something real before anyone types. */
    function trending(options) {
      var request = options || {};
      var region = /^[A-Z]{2}$/.test(str(request.region, 4)) ? request.region : "US";
      var key = "trending|" + region;
      return run(
        key,
        function (record) {
          return {
            path: record.api === "piped" ? "/trending" : "/api/v1/trending",
            params: { region: region },
            validate: isArrayBody
          };
        },
        request.signal
      ).then(function (outcome) {
        if (outcome.cached) return outcome.value;
        var result = outcome.value;
        var piped = result.api === "piped";
        var payload = {
          items: result.data
            .map(function (item) {
              return piped ? normalizePipedVideo(item, result.instance) : normalizeVideo(item, result.instance);
            })
            .filter(Boolean)
            .slice(0, MAX_RESULTS),
          instance: result.instance,
          api: result.api,
          latency: result.latency
        };
        cache.set(key, payload);
        return payload;
      });
    }

    /** One video, with every format a playback plan needs. */
    function video(videoId, options) {
      var request = options || {};
      var id = str(videoId, 20);
      if (!isVideoId(id)) {
        return Promise.reject(errorFor("content", "That is not a YouTube video id."));
      }
      var key = "video|" + id;
      return run(
        key,
        function (instance) {
          if (instance.api === "piped") {
            return { path: "/streams/" + id, params: null, validate: isPipedStreamsBody };
          }
          return { path: "/api/v1/videos/" + id, params: null, validate: isVideoBody };
        },
        request.signal,
        playbackManager
      ).then(function (outcome) {
        if (outcome.cached) return outcome.value;
        var result = outcome.value;
        var record = result.api === "piped"
          ? normalizePipedDetail(result.data, result.instance, id)
          : normalizeVideoDetail(result.data, result.instance);
        if (!record) throw errorFor("malformed", "", { instance: result.instance });
        cache.set(key, record);
        return record;
      });
    }

    function channel(authorId, options) {
      var request = options || {};
      var id = str(authorId, 64);
      if (!CHANNEL_ID.test(id)) {
        return Promise.reject(errorFor("content", "That is not a YouTube channel id."));
      }
      var key = "channel|" + id;
      return run(
        key,
        function (record) {
          // Not wired for Piped: nothing in the UI opens a channel yet, and a
          // request with no path skips that instance rather than failing it.
          if (record.api === "piped") return {};
          return {
            path: "/api/v1/channels/" + id,
            params: null,
            validate: function (body) { return !!body && typeof body === "object"; }
          };
        },
        request.signal
      ).then(function (outcome) {
        if (outcome.cached) return outcome.value;
        var result = outcome.value;
        var payload = {
          channel: normalizeChannel(result.data, result.instance),
          videos: (Array.isArray(result.data.latestVideos) ? result.data.latestVideos : [])
            .map(function (item) { return normalizeVideo(item, result.instance); })
            .filter(Boolean)
            .slice(0, MAX_RESULTS),
          instance: result.instance
        };
        cache.set(key, payload);
        return payload;
      });
    }

    function playlist(playlistId, options) {
      var request = options || {};
      var id = str(playlistId, 64);
      if (!PLAYLIST_ID.test(id)) {
        return Promise.reject(errorFor("content", "That is not a YouTube playlist id."));
      }
      var key = "playlist|" + id;
      return run(
        key,
        function (record) {
          if (record.api === "piped") return {};
          return {
            path: "/api/v1/playlists/" + id,
            params: null,
            validate: function (body) { return !!body && typeof body === "object"; }
          };
        },
        request.signal
      ).then(function (outcome) {
        if (outcome.cached) return outcome.value;
        var result = outcome.value;
        var payload = normalizePlaylist(result.data, result.instance);
        if (!payload) throw errorFor("malformed", "", { instance: result.instance });
        cache.set(key, payload);
        return payload;
      });
    }

    /**
     * Drop a cached video record. Playback URLs expire, so a source that has
     * stopped working is re-resolved rather than replayed from the cache.
     */
    function forget(videoId) {
      cache.drop("video|" + str(videoId, 20));
    }

    return {
      search: search,
      trending: trending,
      video: video,
      channel: channel,
      playlist: playlist,
      forget: forget,
      clear: function () {
        cache.clear();
      },
      get cacheSize() {
        return cache.size;
      }
    };
  }

  global.AstraYouTube = global.AstraYouTube || {};
  global.AstraYouTube.api = {
    VIDEO_ID: VIDEO_ID,
    MAX_RESULTS: MAX_RESULTS,
    plain: plain,
    isVideoId: isVideoId,
    contentKey: contentKey,
    videoIdFromKey: videoIdFromKey,
    videoIdFromInput: videoIdFromInput,
    imageUrl: imageUrl,
    mediaUrl: mediaUrl,
    instanceUrl: instanceUrl,
    pickThumbnail: pickThumbnail,
    normalizeVideo: normalizeVideo,
    normalizeChannel: normalizeChannel,
    normalizePlaylist: normalizePlaylist,
    normalizeResult: normalizeResult,
    normalizeFormat: normalizeFormat,
    normalizeCaptions: normalizeCaptions,
    normalizeVideoDetail: normalizeVideoDetail,
    stripHtml: stripHtml,
    videoIdFromPipedUrl: videoIdFromPipedUrl,
    normalizePipedVideo: normalizePipedVideo,
    normalizePipedChannel: normalizePipedChannel,
    normalizePipedResult: normalizePipedResult,
    normalizePipedFormat: normalizePipedFormat,
    normalizePipedDetail: normalizePipedDetail,
    createCache: createCache,
    createClient: createClient
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
