/**
 * Astra audio player state.
 *
 * Music, radio and podcasts need a player that reports what is genuinely
 * happening: elapsed, duration, and how far the browser has actually buffered.
 * Every number here is read from the media element. Nothing is synthesised —
 * in particular there is no reactive waveform, because the Web Audio analyser
 * data a real one needs is not available for cross-origin add-on streams and
 * drawing a fake one would misrepresent the stream.
 *
 * Dependency free: a classic script in the browser, evaluated in `node:vm` by
 * the tests.
 */
(function (global) {
  "use strict";

  function finite(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * mm:ss, or h:mm:ss past an hour. Live and unknown durations render as a
   * dash rather than 0:00, which would read as a real position.
   */
  function formatTime(seconds) {
    var total = Number(seconds);
    if (!Number.isFinite(total) || total < 0) return "--:--";
    total = Math.floor(total);
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var secs = total % 60;
    var pad = function (n) {
      return n < 10 ? "0" + n : String(n);
    };
    if (hours > 0) return hours + ":" + pad(minutes) + ":" + pad(secs);
    return minutes + ":" + pad(secs);
  }

  /** A live stream has no meaningful duration to scrub within. */
  function isLiveDuration(duration) {
    var value = Number(duration);
    return !Number.isFinite(value) || value <= 0;
  }

  /**
   * How far the browser has buffered past the current position, in seconds.
   * Uses the range containing `currentTime`; ranges ahead of a gap do not
   * count, because playback would stall before reaching them.
   */
  function bufferedAhead(media) {
    if (!media || !media.buffered) return 0;
    var ranges = media.buffered;
    var length = Number(ranges.length) || 0;
    var current = finite(media.currentTime);
    for (var i = 0; i < length; i += 1) {
      var start = finite(ranges.start(i));
      var end = finite(ranges.end(i));
      if (current >= start - 0.25 && current <= end) return Math.max(0, end - current);
    }
    return 0;
  }

  /** 0..1 position within the media, or 0 when there is nothing to scrub. */
  function playedRatio(media) {
    if (!media) return 0;
    var duration = finite(media.duration);
    if (duration <= 0) return 0;
    return Math.min(1, Math.max(0, finite(media.currentTime) / duration));
  }

  /** 0..1 buffered edge, for the track behind the played range. */
  function bufferedRatio(media) {
    if (!media) return 0;
    var duration = finite(media.duration);
    if (duration <= 0) return 0;
    var ahead = bufferedAhead(media);
    return Math.min(1, Math.max(0, (finite(media.currentTime) + ahead) / duration));
  }

  /**
   * One immutable snapshot of everything the UI renders, so the view is a pure
   * function of the media element rather than a pile of ad-hoc reads.
   */
  function snapshot(media) {
    if (!media) {
      return {
        currentTime: 0,
        duration: 0,
        live: true,
        paused: true,
        playedRatio: 0,
        bufferedRatio: 0,
        bufferedAhead: 0,
        elapsedText: "--:--",
        durationText: "--:--",
        remainingText: "--:--"
      };
    }
    var duration = finite(media.duration);
    var live = isLiveDuration(media.duration);
    var currentTime = finite(media.currentTime);
    return {
      currentTime: currentTime,
      duration: duration,
      live: live,
      paused: media.paused !== false,
      playedRatio: playedRatio(media),
      bufferedRatio: bufferedRatio(media),
      bufferedAhead: bufferedAhead(media),
      elapsedText: formatTime(currentTime),
      durationText: live ? "LIVE" : formatTime(duration),
      remainingText: live ? "" : "-" + formatTime(Math.max(0, duration - currentTime))
    };
  }

  /** Convert a 0..1 scrub position into a seek target, clamped to the media. */
  function seekTarget(media, ratio) {
    if (!media) return 0;
    var duration = finite(media.duration);
    if (duration <= 0) return 0;
    var clamped = Math.min(1, Math.max(0, Number(ratio) || 0));
    return clamped * duration;
  }

  /** A readable one-line subtitle: artist/album/provider, whatever exists. */
  function describeTrack(meta, stream) {
    var parts = [];
    var push = function (value) {
      var text = value == null ? "" : String(value).trim();
      if (text && parts.indexOf(text) === -1) parts.push(text);
    };
    if (meta) {
      push(meta.artist);
      push(meta.album);
      if (!parts.length) push(meta.description);
    }
    if (stream) push(stream.addonName);
    return parts.slice(0, 2).join(" · ");
  }

  global.AstraAudio = {
    formatTime: formatTime,
    isLiveDuration: isLiveDuration,
    bufferedAhead: bufferedAhead,
    playedRatio: playedRatio,
    bufferedRatio: bufferedRatio,
    snapshot: snapshot,
    seekTarget: seekTarget,
    describeTrack: describeTrack
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
