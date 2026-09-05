/**
 * Astra playback attempt state machine.
 *
 * A session owns an ordered candidate list for one media item. Each attempt on
 * one candidate gets a unique id; every callback carries the id it was created
 * for and is rejected if it is no longer current. That is what makes stale
 * events from a previous source unable to fail or mutate the live attempt.
 *
 * Failover only ever happens during startup. Once meaningful playback has
 * begun, a failure is surfaced with actions instead of silently switching, and
 * a source is never revisited, so the engine cannot loop.
 *
 * Timers are injected so the tests drive the clock deterministically.
 */
(function (global) {
  "use strict";

  var STATE = {
    IDLE: "idle",
    STARTING: "starting",
    PLAYING: "playing",
    FAILED: "failed",
    EXHAUSTED: "exhausted",
    CANCELLED: "cancelled"
  };

  var FAILURE = {
    ACCESS: "access",
    NETWORK: "network",
    MANIFEST: "manifest",
    DECODE: "decode",
    UNSUPPORTED: "unsupported",
    LIBRARY: "library",
    TIMEOUT: "timeout",
    UNKNOWN: "unknown"
  };

  var FAILURE_TEXT = {
    access: "The source requires access settings this browser cannot apply.",
    network: "The source stopped responding.",
    manifest: "The stream manifest could not be read.",
    decode: "This device could not decode the stream.",
    unsupported: "The browser refused this source.",
    library: "The playback library could not be loaded.",
    timeout: "The source did not start in time.",
    unknown: "Playback failed for an unknown reason."
  };

  var DEFAULT_STARTUP_TIMEOUT_MS = 25000;
  var DEFAULT_MAX_ATTEMPTS = 3;
  var DEFAULT_STALL_TIMEOUT_MS = 30000;
  var DEFAULT_SEEK_TIMEOUT_MS = 45000;
  // Playback is "meaningful" once this much has actually been watched. Past it,
  // an error is reported rather than silently swapping the source underneath.
  var MEANINGFUL_PLAYBACK_SECONDS = 5;

  /** Map an arbitrary error-ish value onto a failure category. */
  function classifyFailure(input) {
    if (!input) return FAILURE.UNKNOWN;
    if (typeof input === "string") {
      var known = FAILURE[input.toUpperCase()];
      return known || FAILURE.UNKNOWN;
    }
    if (input.playbackType && FAILURE[String(input.playbackType).toUpperCase()]) {
      return FAILURE[String(input.playbackType).toUpperCase()];
    }
    if (input.type && FAILURE[String(input.type).toUpperCase()]) {
      return FAILURE[String(input.type).toUpperCase()];
    }
    var message = String(input.message || input.detail || "").toLowerCase();
    if (!message) return FAILURE.UNKNOWN;
    if (message.indexOf("manifest") !== -1 || message.indexOf("m3u8") !== -1 || message.indexOf("mpd") !== -1) {
      return FAILURE.MANIFEST;
    }
    if (message.indexOf("network") !== -1 || message.indexOf("fetch") !== -1 || message.indexOf("load") !== -1) {
      return FAILURE.NETWORK;
    }
    if (message.indexOf("decode") !== -1 || message.indexOf("codec") !== -1) return FAILURE.DECODE;
    if (message.indexOf("support") !== -1) return FAILURE.UNSUPPORTED;
    return FAILURE.UNKNOWN;
  }

  function describeFailure(kind) {
    return FAILURE_TEXT[kind] || FAILURE_TEXT.unknown;
  }

  var sessionCounter = 0;

  /**
   * Create a playback session over a ranked candidate list.
   *
   * `onChange(snapshot)` fires whenever the observable state moves, so the UI
   * can render purely from the snapshot.
   */
  function createSession(config) {
    var options = config || {};
    var candidates = Array.isArray(options.candidates) ? options.candidates.slice() : [];
    // Astra never starts a source the viewer did not choose, so automatic
    // failover is off unless a caller explicitly opts in. `tryNext()` stays:
    // it is a button on the error card, not something the engine decides.
    var autoFailover = options.autoFailover === true;
    var maxAttempts = Number.isFinite(options.maxAttempts) ? options.maxAttempts : DEFAULT_MAX_ATTEMPTS;
    var startupTimeoutMs = Number.isFinite(options.startupTimeoutMs)
      ? options.startupTimeoutMs
      : DEFAULT_STARTUP_TIMEOUT_MS;
    var stallTimeoutMs = Number.isFinite(options.stallTimeoutMs) ? options.stallTimeoutMs : DEFAULT_STALL_TIMEOUT_MS;
    var seekTimeoutMs = Number.isFinite(options.seekTimeoutMs) ? options.seekTimeoutMs : DEFAULT_SEEK_TIMEOUT_MS;
    var schedule = options.setTimeout || function (fn, ms) { return setTimeout(fn, ms); };
    var cancelTimer = options.clearTimeout || function (handle) { clearTimeout(handle); };
    var onChange = typeof options.onChange === "function" ? options.onChange : function () {};
    var startAttempt = typeof options.onAttempt === "function" ? options.onAttempt : null;
    var readPlaybackState = typeof options.readPlaybackState === "function" ? options.readPlaybackState : null;

    sessionCounter += 1;
    var sessionId = "s" + sessionCounter;

    var attemptCounter = 0;
    var currentAttempt = null;
    var state = STATE.IDLE;
    var triedIds = [];
    var lastFailure = null;
    var resumeTime = Number.isFinite(options.resumeTime) ? options.resumeTime : 0;
    var hasMeaningfulPlayback = false;
    var cancelled = false;
    var timeoutHandle = null;
    var stallHandle = null;

    function candidateId(candidate, index) {
      if (!candidate) return "c" + index;
      if (candidate.id) return String(candidate.id);
      var stream = candidate.stream || candidate;
      var key = stream.url || stream.ytId || stream.externalUrl || stream.infoHash || "";
      return key ? "c" + index + ":" + key : "c" + index;
    }

    candidates = candidates.map(function (candidate, index) {
      return {
        id: candidateId(candidate, index),
        index: index,
        entry: candidate,
        stream: candidate && candidate.stream ? candidate.stream : candidate,
        evaluation: (candidate && candidate.evaluation) || null
      };
    });

    /** A candidate this session has not tried yet and could still start. */
    function isEligible(candidate) {
      if (!candidate) return false;
      if (triedIds.indexOf(candidate.id) !== -1) return false;
      return !candidate.evaluation || candidate.evaluation.playable === true;
    }

    function nextEligible() {
      for (var i = 0; i < candidates.length; i += 1) {
        if (isEligible(candidates[i])) return candidates[i];
      }
      return null;
    }

    function snapshot() {
      return {
        sessionId: sessionId,
        state: state,
        attemptId: currentAttempt ? currentAttempt.id : null,
        candidate: currentAttempt ? currentAttempt.candidate : null,
        attemptCount: triedIds.length,
        maxAttempts: maxAttempts,
        triedIds: triedIds.slice(),
        lastFailure: lastFailure,
        resumeTime: resumeTime,
        hasMeaningfulPlayback: hasMeaningfulPlayback,
        canTryNext: !cancelled && triedIds.length < maxAttempts && !!nextEligible(),
        remaining: candidates.filter(isEligible).length
      };
    }

    function emit() {
      onChange(snapshot());
    }

    function clearStartupTimer() {
      if (timeoutHandle === null) return;
      cancelTimer(timeoutHandle);
      timeoutHandle = null;
    }

    function clearStallTimer() {
      if (stallHandle === null) return;
      cancelTimer(stallHandle);
      stallHandle = null;
    }

    function armStartupTimer(attempt) {
      if (timeoutHandle !== null || attempt.paused || attempt.ended) return;
      timeoutHandle = schedule(function () {
        timeoutHandle = null;
        report(attempt.id, "error", { type: FAILURE.TIMEOUT });
      }, startupTimeoutMs);
    }

    // canplay/playing can repeat while a source has stopped delivering frames.
    // Only movement of the playhead renews this deadline, not buffering events.
    function armStallTimer(attempt, reset) {
      if (attempt.paused || attempt.ended) return;
      if (reset) clearStallTimer();
      if (stallHandle !== null) return;
      stallHandle = schedule(function () {
        stallHandle = null;
        if (!isCurrent(attempt.id)) return;
        // Background tabs can delay timeupdate while the media keeps playing.
        // Inspect the element at expiry before declaring that playback froze.
        var media = null;
        try { if (readPlaybackState) media = readPlaybackState(attempt.id); } catch (_) {}
        if (media) {
          if (media.ended || media.paused) {
            report(attempt.id, media.ended ? "ended" : "pause", media);
            return;
          }
          if (media.seeking === true && !attempt.seeking) {
            report(attempt.id, "seeking", media);
            return;
          }
          if (media.seeking === false && attempt.seeking) {
            report(attempt.id, "seeked", media);
            return;
          }
          if (!attempt.seeking && Number.isFinite(media.currentTime) &&
              (attempt.lastMediaTime === null ? media.currentTime > 0 : media.currentTime > attempt.lastMediaTime + 0.01)) {
            report(attempt.id, "progress", media);
            return;
          }
        }
        report(attempt.id, "error", {
          type: FAILURE.TIMEOUT,
          detail: attempt.seeking
            ? "This source could not reach the selected position. Retry or choose another source."
            : "Playback stopped making progress. Retry or choose another source."
        });
      }, attempt.seeking ? seekTimeoutMs : stallTimeoutMs);
    }

    /** An event is live only if it belongs to the current, uncancelled attempt. */
    function isCurrent(attemptId) {
      return !cancelled && !!currentAttempt && currentAttempt.id === attemptId && !currentAttempt.settled;
    }

    function beginAttempt(candidate) {
      attemptCounter += 1;
      var attempt = {
        id: sessionId + "-a" + attemptCounter,
        candidate: candidate,
        settled: false,
        startedAt: attemptCounter,
        ready: false,
        paused: false,
        seeking: false,
        seekPosition: null,
        ended: false,
        lastMediaTime: null
      };
      currentAttempt = attempt;
      triedIds.push(candidate.id);
      state = STATE.STARTING;
      // `lastFailure` deliberately survives into the next attempt so the UI can
      // show which source failed while the replacement is starting. It is
      // cleared once something actually plays.

      clearStartupTimer();
      clearStallTimer();
      armStartupTimer(attempt);

      emit();

      if (startAttempt) {
        // Start synchronously so the attempt is genuinely underway before the
        // caller can report events against it; only failures are deferred.
        var outcome;
        try {
          outcome = startAttempt({ attemptId: attempt.id, candidate: candidate, resumeTime: resumeTime });
        } catch (error) {
          report(attempt.id, "error", error);
          return attempt;
        }
        if (outcome && typeof outcome.then === "function") {
          outcome.catch(function (error) {
            report(attempt.id, "error", error);
          });
        }
      }
      return attempt;
    }

    function finishAttempt(attempt) {
      attempt.settled = true;
      clearStartupTimer();
      clearStallTimer();
    }

    function failCurrent(failureKind, detail, evidence) {
      var attempt = currentAttempt;
      var failedCandidate = attempt ? attempt.candidate : null;
      finishAttempt(attempt);
      lastFailure = {
        kind: failureKind,
        text: failureKind === FAILURE.TIMEOUT && attempt && (attempt.ready || attempt.seeking)
          ? (attempt.seeking ? "The source could not reach that position." : "Playback stopped responding.")
          : describeFailure(failureKind),
        detail: detail || "",
        playbackCode: evidence && evidence.playbackCode,
        playbackStage: evidence && evidence.playbackStage,
        playbackCodec: evidence && evidence.playbackCodec,
        candidate: failedCandidate,
        afterPlayback: hasMeaningfulPlayback
      };

      // Off by default, and never once real playback happened: switching
      // sources is the viewer's decision, not the player's.
      var mayFailover = autoFailover && !hasMeaningfulPlayback && triedIds.length < maxAttempts;
      var next = mayFailover ? nextEligible() : null;

      if (next) {
        beginAttempt(next);
        return;
      }

      state = nextEligible() ? STATE.FAILED : STATE.EXHAUSTED;
      currentAttempt = null;
      emit();
    }

    /**
     * Feed a playback event in. `attemptId` scopes it: an event from a
     * superseded attempt is dropped, so a late error from source A can never
     * fail source B.
     */
    function report(attemptId, event, detail) {
      if (!isCurrent(attemptId)) return false;

      var attempt = currentAttempt;
      var seconds = Number(detail && detail.currentTime);
      var hasPosition = !!detail && detail.currentTime != null && Number.isFinite(seconds) && seconds >= 0;
      if (detail && typeof detail.paused === "boolean") {
        attempt.paused = detail.paused;
        if (attempt.paused) {
          // Before readiness, a newly attached element is often still paused
          // while its adapter fetches metadata. That is not a user pause.
          if (attempt.ready) clearStartupTimer();
          clearStallTimer();
        }
      }

      if (event === "ready" || event === "playing") {
        var firstReady = !attempt.ready;
        attempt.ready = true;
        if (firstReady && hasPosition) attempt.lastMediaTime = seconds;
        if (event === "playing") {
          attempt.paused = false;
          attempt.ended = false;
        }
        if (detail && detail.seeking === true) attempt.seeking = true;
        clearStartupTimer();
        armStallTimer(attempt, false);
        state = STATE.PLAYING;
        lastFailure = null;
        if (firstReady) emit();
        return true;
      }

      if (event === "play") {
        attempt.paused = false;
        attempt.ended = false;
        if (attempt.ready || attempt.seeking) armStallTimer(attempt, false);
        else armStartupTimer(attempt);
        return true;
      }

      if (event === "pause" || event === "ended") {
        attempt.paused = true;
        attempt.ended = event === "ended";
        clearStartupTimer();
        clearStallTimer();
        return true;
      }

      if (event === "seeking") {
        var newSeek = !attempt.seeking || (hasPosition && seconds !== attempt.seekPosition);
        attempt.seeking = true;
        attempt.seekPosition = hasPosition ? seconds : null;
        if (hasPosition) {
          attempt.lastMediaTime = seconds;
          resumeTime = seconds;
        }
        if (attempt.ready || !attempt.paused) clearStartupTimer();
        armStallTimer(attempt, newSeek);
        return true;
      }

      if (event === "seeked") {
        var wasSeeking = attempt.seeking;
        attempt.seeking = false;
        attempt.seekPosition = null;
        if (hasPosition) {
          attempt.lastMediaTime = seconds;
          resumeTime = seconds;
        }
        armStallTimer(attempt, wasSeeking);
        return true;
      }

      if (event === "waiting" || event === "stalled") {
        // Before canplay, the original startup deadline remains in force.
        if (attempt.ready || attempt.seeking) armStallTimer(attempt, false);
        return true;
      }

      if (event === "progress") {
        if (hasPosition) {
          var advancing = attempt.lastMediaTime === null ? seconds > 0 : seconds > attempt.lastMediaTime + 0.01;
          attempt.lastMediaTime = seconds;
          resumeTime = seconds;
          if (!attempt.paused && !attempt.ended && !attempt.seeking && !(detail && detail.seeking)) {
            if (advancing) {
              clearStartupTimer();
              armStallTimer(attempt, true);
            }
            if (seconds >= MEANINGFUL_PLAYBACK_SECONDS && !hasMeaningfulPlayback) {
              hasMeaningfulPlayback = true;
              emit();
            }
          }
        }
        return true;
      }

      if (event === "error") {
        failCurrent(classifyFailure(detail), (detail && (detail.detail || detail.message)) || "", detail);
        return true;
      }

      return false;
    }

    function start() {
      if (cancelled || currentAttempt) return snapshot();
      var first = nextEligible();
      if (!first) {
        state = STATE.EXHAUSTED;
        emit();
        return snapshot();
      }
      beginAttempt(first);
      return snapshot();
    }

    /** Explicit user action: move to the next eligible source, ignoring auto rules. */
    function tryNext() {
      if (cancelled) return false;
      if (triedIds.length >= maxAttempts) return false;
      var next = nextEligible();
      if (!next) return false;
      if (currentAttempt) finishAttempt(currentAttempt);
      beginAttempt(next);
      return true;
    }

    /** Explicit user action: retry the source that just failed. */
    function retry() {
      if (cancelled) return false;
      // Retry the attempt in flight when there is one; otherwise the source
      // that just failed, which is the case the error card acts on.
      var candidate = (currentAttempt && currentAttempt.candidate) || (lastFailure && lastFailure.candidate);
      if (!candidate) return false;
      if (currentAttempt) finishAttempt(currentAttempt);
      // A retry re-runs the same source, so let it be attempted again.
      var at = triedIds.indexOf(candidate.id);
      if (at !== -1) triedIds.splice(at, 1);
      beginAttempt(candidate);
      return true;
    }

    /** Explicit user action: play one specific candidate from the picker. */
    function play(candidateOrId) {
      if (cancelled) return false;
      var wanted = String((candidateOrId && candidateOrId.id) || candidateOrId);
      var chosen = null;
      for (var i = 0; i < candidates.length; i += 1) {
        if (candidates[i].id === wanted) chosen = candidates[i];
      }
      if (!chosen) return false;
      if (currentAttempt) finishAttempt(currentAttempt);
      var at = triedIds.indexOf(chosen.id);
      if (at !== -1) triedIds.splice(at, 1);
      // A deliberate choice resets the automatic budget.
      hasMeaningfulPlayback = false;
      beginAttempt(chosen);
      return true;
    }

    /**
     * Tear the session down. Pending timers are cleared and every later event
     * is ignored, so nothing can resurrect a closed player.
     */
    function cancel() {
      if (cancelled) return false;
      cancelled = true;
      if (currentAttempt) finishAttempt(currentAttempt);
      clearStartupTimer();
      clearStallTimer();
      currentAttempt = null;
      state = STATE.CANCELLED;
      emit();
      return true;
    }

    return {
      sessionId: sessionId,
      STATE: STATE,
      start: start,
      report: report,
      tryNext: tryNext,
      retry: retry,
      play: play,
      cancel: cancel,
      snapshot: snapshot,
      candidates: function () {
        return candidates.slice();
      },
      get cancelled() {
        return cancelled;
      }
    };
  }

  global.AstraPlayback = global.AstraPlayback || {};
  global.AstraPlayback.engine = {
    STATE: STATE,
    FAILURE: FAILURE,
    MEANINGFUL_PLAYBACK_SECONDS: MEANINGFUL_PLAYBACK_SECONDS,
    DEFAULT_STARTUP_TIMEOUT_MS: DEFAULT_STARTUP_TIMEOUT_MS,
    DEFAULT_MAX_ATTEMPTS: DEFAULT_MAX_ATTEMPTS,
    DEFAULT_STALL_TIMEOUT_MS: DEFAULT_STALL_TIMEOUT_MS,
    DEFAULT_SEEK_TIMEOUT_MS: DEFAULT_SEEK_TIMEOUT_MS,
    classifyFailure: classifyFailure,
    describeFailure: describeFailure,
    createSession: createSession
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
