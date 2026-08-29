/**
 * Astra episode ordering, continuity and the autoplay countdown.
 *
 * Add-ons return `videos` in whatever order they like, and season/episode
 * metadata is often partial. Ordering is therefore explicit rather than
 * trusting array position, and every lookup degrades to the original order
 * when metadata is missing.
 */
(function (global) {
  "use strict";

  // Types that have no episode concept at all. Showing previous/next on these
  // would be nonsense.
  var EPISODIC_TYPES = ["series", "tv", "anime"];

  function num(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function idOf(video) {
    return video && video.id != null ? String(video.id) : "";
  }

  /**
   * Chronological order: season, then episode, then the add-on's own order as a
   * stable tiebreaker. Specials (season 0) sort after the numbered seasons, so
   * "next episode" from a finale does not jump into a special. Videos with no
   * season/episode metadata keep their relative order at the end.
   */
  function orderVideos(videos) {
    if (!Array.isArray(videos)) return [];
    var decorated = videos
      .filter(function (video) {
        return video && typeof video === "object";
      })
      .map(function (video, index) {
        var season = num(video.season);
        var episode = num(video.episode);
        return {
          video: video,
          index: index,
          hasMeta: season !== null || episode !== null,
          // Season 0 is the specials bucket: sort it last.
          season: season === null ? Number.MAX_SAFE_INTEGER : season === 0 ? Number.MAX_SAFE_INTEGER - 1 : season,
          episode: episode === null ? Number.MAX_SAFE_INTEGER : episode
        };
      });

    decorated.sort(function (a, b) {
      if (a.hasMeta !== b.hasMeta) return a.hasMeta ? -1 : 1;
      if (a.season !== b.season) return a.season - b.season;
      if (a.episode !== b.episode) return a.episode - b.episode;
      return a.index - b.index;
    });

    return decorated.map(function (item) {
      return item.video;
    });
  }

  function indexOfVideo(ordered, videoId) {
    var wanted = String(videoId);
    for (var i = 0; i < ordered.length; i += 1) {
      if (idOf(ordered[i]) === wanted) return i;
    }
    return -1;
  }

  function nextEpisode(videos, videoId) {
    var ordered = orderVideos(videos);
    var at = indexOfVideo(ordered, videoId);
    if (at === -1) return null;
    return ordered[at + 1] || null;
  }

  function previousEpisode(videos, videoId) {
    var ordered = orderVideos(videos);
    var at = indexOfVideo(ordered, videoId);
    if (at <= 0) return null;
    return ordered[at - 1] || null;
  }

  /** Does this media have real episodes worth navigating? */
  function isEpisodic(meta) {
    if (!meta || typeof meta !== "object") return false;
    if (!Array.isArray(meta.videos) || meta.videos.length < 2) return false;
    return EPISODIC_TYPES.indexOf(String(meta.type || "").toLowerCase()) !== -1;
  }

  function episodeCode(video) {
    if (!video) return "";
    var parts = [];
    if (video.season != null) parts.push("S" + video.season);
    if (video.episode != null) parts.push("E" + video.episode);
    return parts.join("");
  }

  function episodeLabel(video) {
    if (!video) return "";
    var code = episodeCode(video);
    var title = String(video.title || video.name || "Episode");
    return code ? code + " · " + title : title;
  }

  /**
   * Where "Continue" should go: the most recently watched incomplete episode,
   * or the one after the most recently completed. Falls back to the first
   * episode when there is no history.
   */
  function resumeTarget(meta, lookup) {
    var ordered = orderVideos(meta && meta.videos);
    if (!ordered.length) return { video: meta || null, reason: "single" };
    var get = typeof lookup === "function" ? lookup : function () { return null; };

    var newest = null;
    ordered.forEach(function (video) {
      var record = get(idOf(video));
      if (!record) return;
      var updated = Number(record.updated) || 0;
      if (!newest || updated > newest.updated) newest = { video: video, record: record, updated: updated };
    });

    if (!newest) return { video: ordered[0], reason: "first" };

    if (!newest.record.completed) return { video: newest.video, reason: "resume", progress: newest.record };

    var following = nextEpisode(ordered, idOf(newest.video));
    if (following) return { video: following, reason: "next", after: newest.video };
    return { video: newest.video, reason: "finished", progress: newest.record };
  }

  /**
   * A visible countdown before the next episode starts.
   *
   * `cancel()` is idempotent and permanent: once cancelled, no tick or
   * completion callback can fire, which is what stops a countdown from
   * outliving a closed player.
   */
  function createCountdown(options) {
    var config = options || {};
    var seconds = Number.isFinite(config.seconds) ? Math.max(1, Math.floor(config.seconds)) : 10;
    var schedule = config.setTimeout || function (fn, ms) { return setTimeout(fn, ms); };
    var cancelTimer = config.clearTimeout || function (handle) { clearTimeout(handle); };
    var onTick = typeof config.onTick === "function" ? config.onTick : function () {};
    var onDone = typeof config.onDone === "function" ? config.onDone : function () {};

    var remaining = seconds;
    var handle = null;
    var finished = false;
    var cancelled = false;

    function stopTimer() {
      if (handle === null) return;
      cancelTimer(handle);
      handle = null;
    }

    function step() {
      handle = null;
      if (cancelled || finished) return;
      remaining -= 1;
      if (remaining > 0) {
        onTick(remaining);
        handle = schedule(step, 1000);
        return;
      }
      finished = true;
      onTick(0);
      onDone();
    }

    function start() {
      if (cancelled || finished || handle !== null) return api;
      onTick(remaining);
      handle = schedule(step, 1000);
      return api;
    }

    function cancel() {
      if (cancelled || finished) return false;
      cancelled = true;
      stopTimer();
      return true;
    }

    /** Skip the wait and run the completion immediately. */
    function finishNow() {
      if (cancelled || finished) return false;
      finished = true;
      stopTimer();
      remaining = 0;
      onDone();
      return true;
    }

    var api = {
      start: start,
      cancel: cancel,
      finishNow: finishNow,
      get remaining() {
        return remaining;
      },
      get cancelled() {
        return cancelled;
      },
      get finished() {
        return finished;
      }
    };
    return api;
  }

  global.AstraPlayback = global.AstraPlayback || {};
  global.AstraPlayback.episodes = {
    EPISODIC_TYPES: EPISODIC_TYPES,
    orderVideos: orderVideos,
    nextEpisode: nextEpisode,
    previousEpisode: previousEpisode,
    isEpisodic: isEpisodic,
    episodeCode: episodeCode,
    episodeLabel: episodeLabel,
    resumeTarget: resumeTarget,
    createCountdown: createCountdown
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
