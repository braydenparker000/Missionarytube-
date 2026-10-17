/* A moving media clock can be audio alone. This first-picture check offers an
   advisory; it never pauses, fails, or replaces an otherwise usable stream. */
(function (global) {
  'use strict';

  const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

  function readMedia(media) {
    let quality = null;
    try { quality = media?.getVideoPlaybackQuality?.(); } catch (_) {}
    const totalFrames = nonnegative(quality?.totalVideoFrames);
    return {
      position: nonnegative(media?.currentTime),
      duration: nonnegative(media?.duration),
      readyState: nonnegative(media?.readyState),
      paused: media?.paused !== false,
      seeking: media?.seeking === true,
      ended: media?.ended === true,
      playbackRate: nonnegative(media?.playbackRate),
      videoWidth: nonnegative(media?.videoWidth),
      videoHeight: nonnegative(media?.videoHeight),
      frameMetricsAvailable: totalFrames !== null,
      totalFrames,
      droppedFrames: nonnegative(quality?.droppedVideoFrames)
    };
  }

  function create({ now = () => Date.now(), onMissing } = {}) {
    let previous = null, observedSeconds = 0, observedVideo = false, notified = false;

    // Reset only the observation window. One monitor belongs to one attempt,
    // so changing visibility or seeking cannot repeatedly reopen an advisory.
    function reset() {
      previous = null;
      observedSeconds = 0;
    }

    function snapshot() {
      return { missing: notified && !observedVideo, observedVideo, notified, observedSeconds };
    }

    function observe(media, { visible = false, audioOnly = false } = {}) {
      const metrics = readMedia(media);
      // Dimensions are conservative evidence that the browser found a video
      // track. This check is deliberately not a detector for later freezes.
      if (metrics.videoWidth > 0 || metrics.videoHeight > 0 || metrics.totalFrames > 0) observedVideo = true;
      if (observedVideo || notified) return snapshot();

      if (!visible || audioOnly || metrics.paused || metrics.seeking || metrics.ended ||
          metrics.readyState < 2 || metrics.position === null ||
          metrics.videoWidth !== 0 || metrics.videoHeight !== 0 ||
          !metrics.frameMetricsAvailable || metrics.totalFrames !== 0 ||
          !(metrics.playbackRate > 0)) {
        reset();
        return snapshot();
      }

      const current = { time: now(), position: metrics.position, rate: metrics.playbackRate };
      if (previous) {
        const seconds = (current.time - previous.time) / 1000;
        const advance = current.position - previous.position;
        const expected = seconds * current.rate;
        // Long event gaps can cross background suspension; large clock jumps
        // can be seeks whose DOM events have not arrived. Neither is watching.
        if (seconds <= 0 || seconds > 2 || previous.rate !== current.rate ||
            advance <= 0 || advance > expected + Math.max(0.25, expected * 0.15)) {
          observedSeconds = 0;
        } else {
          observedSeconds += Math.min(seconds, advance / current.rate);
        }
      }
      previous = current;
      if (observedSeconds >= 8) {
        notified = true;
        if (typeof onMissing === 'function') onMissing(metrics);
      }
      return snapshot();
    }

    return { observe, reset, snapshot };
  }

  global.AstraPlayback = global.AstraPlayback || {};
  global.AstraPlayback.videoHealth = { readMedia, create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
