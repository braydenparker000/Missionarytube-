/**
 * Turning an Invidious video record into something a browser will actually
 * play, and into a quality ladder that does not lie.
 *
 * The honest constraints, which decide the whole design:
 *
 *   Progressive (`formatStreams`) carries video and audio in one file, so it
 *   can be assigned straight to `<video src>`. A media element load is not a
 *   CORS request, which is why this works against Google's hosts with no
 *   proxy at all. The catch is that YouTube now publishes at most 360p, and
 *   occasionally 720p, this way.
 *
 *   Adaptive (`adaptiveFormats`) is video-only and audio-only, separately.
 *   Two URLs cannot be assigned to one `<video>` element - the correct
 *   browser-side answer is Media Source Extensions, which is what dash.js
 *   does with the DASH manifest Invidious generates for the same formats.
 *   MSE fetches segments from JavaScript, so it *does* need CORS, and
 *   Google's video hosts do not send it. That is the one specific
 *   compatibility case where the stream has to be routed through the
 *   Invidious instance (`local=true`), and it is why adaptive playback is on
 *   for our own server and off by default for a stranger's.
 *
 *   Live streams have neither: Invidious exposes `hlsUrl`, which is HLS
 *   through the instance, so hls.js handles them.
 *
 * A quality is only offered when the browser says it can decode the video
 * *and* a decodable audio format exists to pair with it - advertising 1080p
 * whose audio track cannot be played would be advertising silence.
 *
 * Loaded as a classic browser script and through node:vm in the tests.
 */
(function (global) {
  "use strict";

  var KIND = { PROGRESSIVE: "progressive", DASH: "dash", HLS: "hls" };

  // Below this a "quality" is not a choice anyone wants; above `maxHeight` a
  // phone is being handed work it cannot sustain.
  var MIN_HEIGHT = 144;

  // A signed playback URL is refreshed this long before it lapses, so a start
  // that begins just under the wire does not die a second later.
  var EXPIRY_MARGIN_MS = 120000;

  function str(value) {
    return value == null ? "" : String(value);
  }

  function heightLabel(height) {
    return height > 0 ? height + "p" : "";
  }

  /**
   * Capability probe. The synchronous half reuses Astra's existing media
   * checks; the MSE half is separate because `MediaSource.isTypeSupported` is
   * the only honest answer for a stream that will be fed through Media Source
   * Extensions rather than handed to the element as a file.
   */
  function browserCapabilities(win) {
    var w = win || global;
    var base = global.AstraPlayback && global.AstraPlayback.streams
      ? global.AstraPlayback.streams.browserCapabilities(w)
      : { canPlayType: function () { return ""; }, mse: false, hlsSupported: false, dashSupported: false };
    var Source = w.MediaSource || w.ManagedMediaSource;
    var isTypeSupported = Source && typeof Source.isTypeSupported === "function"
      ? function (type) {
          try {
            return Source.isTypeSupported(type) === true;
          } catch (error) {
            return false;
          }
        }
      : function () { return false; };
    return {
      canPlayType: base.canPlayType,
      mse: base.mse,
      hlsSupported: base.hlsSupported,
      dashSupported: base.dashSupported,
      isTypeSupported: isTypeSupported
    };
  }

  /** A capability object for tests and for callers that know the answers. */
  function capabilities(overrides) {
    var given = overrides || {};
    return {
      canPlayType: typeof given.canPlayType === "function" ? given.canPlayType : function () { return ""; },
      mse: given.mse === true,
      hlsSupported: given.hlsSupported === true,
      dashSupported: given.dashSupported === true,
      isTypeSupported: typeof given.isTypeSupported === "function" ? given.isTypeSupported : function () { return false; }
    };
  }

  /**
   * When a signed playback URL stops being valid. Google puts `expire` in the
   * query as epoch seconds; anything else is treated as non-expiring rather
   * than guessed at.
   */
  function expiresAt(url) {
    var raw = str(url);
    if (!raw) return 0;
    var parsed;
    try {
      parsed = new URL(raw);
    } catch (error) {
      return 0;
    }
    var value = parsed.searchParams.get("expire");
    if (!value) {
      var embedded = /[/&?]expire[/=](\d{9,12})/.exec(raw);
      value = embedded ? embedded[1] : "";
    }
    var epoch = Number(value);
    return Number.isFinite(epoch) && epoch > 0 ? epoch * 1000 : 0;
  }

  /** Whether a plan's direct URLs are close enough to lapsing to re-resolve. */
  function planExpired(plan, moment) {
    var at = Number(moment) || Date.now();
    return (plan && Array.isArray(plan.variants) ? plan.variants : []).some(function (variant) {
      return variant.expiresAt > 0 && variant.expiresAt - EXPIRY_MARGIN_MS <= at;
    });
  }

  /**
   * The instance URL that streams the given itag through the instance itself.
   *
   * `latest_version` is used rather than the signed URL from the API because
   * it does not expire and it re-resolves server side, which is exactly what a
   * recovery path should do.
   */
  function proxiedProgressiveUrl(instance, videoId, itag) {
    if (!instance || !videoId || !itag) return "";
    return instance + "/latest_version?id=" + encodeURIComponent(videoId) +
      "&itag=" + encodeURIComponent(itag) + "&local=true";
  }

  /** The DASH manifest, with segments routed through the instance. */
  function dashManifestUrl(dashUrl) {
    var raw = str(dashUrl);
    if (!raw) return "";
    return raw + (raw.indexOf("?") === -1 ? "?" : "&") + "local=true";
  }

  /**
   * The adaptive video representations a browser can genuinely play.
   *
   * Both halves have to hold: the video codec must be decodable through MSE,
   * and there must be at least one audio format that also is. A ladder rung
   * with no playable audio is not a rung.
   */
  function adaptiveLadder(video, caps, maxHeight) {
    var formats = Array.isArray(video.adaptiveFormats) ? video.adaptiveFormats : [];
    var audio = formats.filter(function (format) {
      return format.audioOnly && caps.isTypeSupported(format.contentType);
    });
    if (!audio.length) return [];

    var ceiling = Number(maxHeight) || 1080;
    var seen = {};
    return formats
      .filter(function (format) {
        if (!format.videoOnly) return false;
        if (format.height < MIN_HEIGHT || format.height > ceiling) return false;
        return caps.isTypeSupported(format.contentType);
      })
      .sort(function (a, b) {
        if (b.height !== a.height) return b.height - a.height;
        return b.bitrate - a.bitrate;
      })
      .filter(function (format) {
        if (seen[format.height]) return false;
        seen[format.height] = true;
        return true;
      });
  }

  /** The muxed formats the element can play as a plain file. */
  function progressiveFormats(video, caps, maxHeight) {
    var ceiling = Number(maxHeight) || 1080;
    var seen = {};
    return (Array.isArray(video.formatStreams) ? video.formatStreams : [])
      .filter(function (format) {
        if (format.audioOnly || format.videoOnly) return false;
        if (format.height && format.height > ceiling) return false;
        // An empty verdict means the browser said no. "maybe" is kept: it is
        // how Chrome answers for a container it will in fact play.
        return caps.canPlayType(format.contentType) !== "";
      })
      .sort(function (a, b) { return b.height - a.height; })
      .filter(function (format) {
        var key = format.height + "|" + format.itag;
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
  }

  function variantLabel(kind, format, proxied) {
    if (kind === KIND.DASH) return "Auto (adaptive)";
    if (kind === KIND.HLS) return "Live (HLS)";
    var parts = [heightLabel(format.height) || format.quality || "Progressive"];
    if (format.container) parts.push(format.container.toUpperCase());
    if (proxied) parts.push("via instance");
    return parts.join(" · ");
  }

  /**
   * A codec name in words, so the source picker's own detection (which reads
   * release titles, because that is all a Stremio add-on gives it) sees the
   * same truth the API reported.
   */
  function codecWords(format) {
    var codecs = str(format && format.codecs).toLowerCase();
    if (codecs.indexOf("av01") !== -1) return "AV1";
    if (codecs.indexOf("hev1") !== -1 || codecs.indexOf("hvc1") !== -1) return "HEVC";
    if (codecs.indexOf("vp9") !== -1 || codecs.indexOf("vp09") !== -1) return "VP9";
    if (codecs.indexOf("avc1") !== -1) return "H.264";
    return "";
  }

  /**
   * Build the ordered playback plan for one video.
   *
   * Order is the failover order: the first entry is what a tap starts. It puts
   * the best delivery this configuration can actually sustain first and keeps
   * the ones that need nothing from our server behind it, so a failure walks
   * down to something simpler rather than off a cliff.
   */
  function buildPlan(video, options) {
    var settings = options || {};
    var config = settings.config || {};
    var caps = settings.capabilities ? capabilities(settings.capabilities) : capabilities();
    var instance = str(settings.instance || (video && video.instance));
    var maxHeight = config.maxHeight || 1080;
    var variants = [];
    var problems = [];

    if (!video || !video.videoId) {
      return { videoId: "", instance: instance, live: false, variants: [], qualities: [], captions: [], problems: ["no-video"] };
    }

    var live = video.live === true;
    var progressive = progressiveFormats(video, caps, maxHeight);
    var ladder = caps.mse ? adaptiveLadder(video, caps, maxHeight) : [];
    var dashUrl = dashManifestUrl(video.dashUrl);
    var canDash = !!dashUrl && caps.mse && caps.dashSupported && ladder.length > 0;
    var wantsAdaptive = config.preferAdaptive !== false;

    function push(variant) {
      variant.id = variant.kind + ":" + (variant.itag || variant.height || variants.length);
      variant.expiresAt = variant.proxied ? 0 : expiresAt(variant.url);
      variants.push(variant);
      return variant;
    }

    // Live has exactly one delivery, so it leads unconditionally.
    if (live && video.hlsUrl && (caps.hlsSupported || caps.mse)) {
      push({
        kind: KIND.HLS,
        label: "Live (HLS)",
        height: 0,
        url: video.hlsUrl,
        contentType: "application/vnd.apple.mpegurl",
        container: "",
        codec: "",
        itag: "hls",
        proxied: true,
        adaptive: true,
        bitrate: 0
      });
    }

    var dashVariant = null;
    if (canDash) {
      dashVariant = {
        kind: KIND.DASH,
        label: "Auto (adaptive)",
        height: ladder[0].height,
        url: dashUrl,
        contentType: ladder[0].contentType,
        container: "MPD",
        codec: codecWords(ladder[0]),
        itag: "dash",
        proxied: true,
        adaptive: true,
        bitrate: ladder[0].bitrate,
        heights: ladder.map(function (format) { return format.height; })
      };
    }

    if (dashVariant && wantsAdaptive) push(dashVariant);

    progressive.forEach(function (format) {
      push({
        kind: KIND.PROGRESSIVE,
        label: variantLabel(KIND.PROGRESSIVE, format, false),
        height: format.height,
        url: format.url,
        contentType: format.contentType,
        container: format.container,
        codec: codecWords(format),
        itag: format.itag,
        proxied: false,
        adaptive: false,
        bitrate: format.bitrate
      });
    });

    if (dashVariant && !wantsAdaptive) push(dashVariant);

    // The recovery path. A signed Google URL can be bound to the address that
    // requested it, in which case the browser gets a 403 and nothing plays;
    // re-resolving the same itag through the instance is what fixes that.
    if (instance && !live) {
      progressive.forEach(function (format) {
        var url = proxiedProgressiveUrl(instance, video.videoId, format.itag);
        if (!url) return;
        push({
          kind: KIND.PROGRESSIVE,
          label: variantLabel(KIND.PROGRESSIVE, format, true),
          height: format.height,
          url: url,
          contentType: format.contentType,
          container: format.container,
          codec: codecWords(format),
          itag: format.itag + "-local",
          proxied: true,
          adaptive: false,
          bitrate: format.bitrate
        });
      });
    }

    if (!variants.length) {
      problems.push(video.upcoming ? "upcoming" : progressive.length || ladder.length ? "no-delivery" : "no-formats");
    }
    if (!caps.mse && ladder.length === 0 && video.adaptiveFormats && video.adaptiveFormats.length) {
      problems.push("no-mse");
    }

    return {
      videoId: video.videoId,
      instance: instance,
      live: live,
      upcoming: video.upcoming === true,
      variants: variants,
      qualities: qualityLadder(variants, dashVariant && wantsAdaptive ? dashVariant : null, ladder),
      captions: Array.isArray(video.captions) ? video.captions : [],
      problems: problems
    };
  }

  /**
   * The menu the player shows.
   *
   * "Auto" only exists when there is an adaptive variant to be automatic
   * about. Each height prefers the adaptive route, because switching a DASH
   * representation keeps the buffer and the position; a progressive height is
   * offered only when adaptive cannot reach it, and costs a reload.
   */
  function qualityLadder(variants, dashVariant, ladder) {
    var out = [];
    var seen = {};

    if (dashVariant) {
      out.push({
        id: "auto",
        label: "Auto",
        detail: "Adapts to the connection",
        height: 0,
        variantId: dashVariant.id,
        representation: null,
        inPlace: true
      });
      (ladder || []).forEach(function (format) {
        if (seen[format.height]) return;
        seen[format.height] = true;
        out.push({
          id: "h" + format.height,
          label: heightLabel(format.height),
          detail: codecWords(format) || "Adaptive",
          height: format.height,
          variantId: dashVariant.id,
          representation: format.height,
          inPlace: true
        });
      });
    }

    variants
      .filter(function (variant) { return variant.kind === KIND.PROGRESSIVE && variant.height >= MIN_HEIGHT; })
      .forEach(function (variant) {
        if (seen[variant.height]) return;
        seen[variant.height] = true;
        out.push({
          id: "h" + variant.height,
          label: heightLabel(variant.height),
          detail: variant.codec || variant.container.toUpperCase() || "Progressive",
          height: variant.height,
          variantId: variant.id,
          representation: null,
          inPlace: false
        });
      });

    // Auto is not a height, so it is not sorted among them: it stays at the
    // top where it is the default, and the rungs descend under it.
    var auto = out.filter(function (entry) { return entry.id === "auto"; });
    var heights = out.filter(function (entry) { return entry.id !== "auto"; });
    heights.sort(function (a, b) { return b.height - a.height; });
    return auto.concat(heights);
  }

  /**
   * Present the plan as Astra stream records.
   *
   * This is the whole integration: once a YouTube variant looks like every
   * other stream Astra handles, the source picker, the compatibility
   * evaluation, the playback engine, the adapters, progress and Continue
   * Watching all work on it without knowing YouTube exists.
   */
  function toStreams(plan, video) {
    return (plan && plan.variants ? plan.variants : []).map(function (variant) {
      var facts = [variant.label, variant.codec].filter(Boolean).join(" · ");
      return {
        name: "YouTube",
        title: facts,
        description: variant.proxied
          ? "Streamed through your Invidious server."
          : "Streamed directly from Google's video hosts.",
        url: variant.url,
        behaviorHints: {
          // The container hint is how the shared stream normalizer learns what
          // this is: a Google playback URL carries no file extension.
          //
          // The video's own title deliberately stays out of it. That normalizer
          // reads a stream's text for resolution, codec and HDR because for an
          // add-on the title *is* the release name - but a YouTube title is
          // just a title, and "A 1080p Capable Video" is not a claim about
          // what is being delivered.
          filename: "youtube-" + variant.itag + "." +
            (variant.kind === KIND.DASH ? "mpd" : variant.kind === KIND.HLS ? "m3u8" : (variant.container || "mp4").toLowerCase()),
          streamType: variant.kind === KIND.DASH ? "dash" : variant.kind === KIND.HLS ? "hls" : undefined,
          isLive: plan.live === true
        },
        _addonName: "YouTube",
        _addonOrder: 0,
        _youtube: {
          videoId: plan.videoId,
          variantId: variant.id,
          kind: variant.kind,
          height: variant.height,
          proxied: variant.proxied,
          adaptive: variant.adaptive,
          instance: plan.instance,
          expiresAt: variant.expiresAt
        }
      };
    });
  }

  /** The caption list in the shape Astra's subtitle module already accepts. */
  function toSubtitles(plan) {
    return (plan && plan.captions ? plan.captions : []).map(function (caption, index) {
      return {
        id: "yt" + index,
        url: caption.url,
        lang: caption.lang,
        label: caption.label,
        // Instance captions are cross-origin to the app, and a cross-origin
        // `<track src>` needs CORS the media element is not configured for.
        // Fetching them and attaching a blob is the path that actually works.
        inline: true,
        _addonName: "YouTube"
      };
    });
  }

  /** Which ladder entry the player should show as current. */
  function activeQuality(plan, variantId, representationHeight) {
    var entries = plan && plan.qualities ? plan.qualities : [];
    for (var i = 0; i < entries.length; i += 1) {
      var entry = entries[i];
      if (entry.variantId !== variantId) continue;
      if (entry.representation === null && representationHeight == null) return entry;
      if (entry.representation !== null && entry.representation === representationHeight) return entry;
    }
    // An adaptive variant with no pinned representation is being automatic.
    for (var j = 0; j < entries.length; j += 1) {
      if (entries[j].variantId === variantId && entries[j].id === "auto") return entries[j];
    }
    return null;
  }

  function variantById(plan, id) {
    var list = plan && plan.variants ? plan.variants : [];
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  global.AstraYouTube = global.AstraYouTube || {};
  global.AstraYouTube.playback = {
    KIND: KIND,
    MIN_HEIGHT: MIN_HEIGHT,
    EXPIRY_MARGIN_MS: EXPIRY_MARGIN_MS,
    capabilities: capabilities,
    browserCapabilities: browserCapabilities,
    expiresAt: expiresAt,
    planExpired: planExpired,
    proxiedProgressiveUrl: proxiedProgressiveUrl,
    dashManifestUrl: dashManifestUrl,
    adaptiveLadder: adaptiveLadder,
    progressiveFormats: progressiveFormats,
    codecWords: codecWords,
    qualityLadder: qualityLadder,
    buildPlan: buildPlan,
    toStreams: toStreams,
    toSubtitles: toSubtitles,
    activeQuality: activeQuality,
    variantById: variantById
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
