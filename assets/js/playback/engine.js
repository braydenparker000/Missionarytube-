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
    NETWORK: "network",
    MANIFEST: "manifest",
    DECODE: "decode",
    UNSUPPORTED: "unsupported",
    LIBRARY: "library",
    TIMEOUT: "timeout",
    UNKNOWN: "unknown"
  };

  var FAILURE_TEXT = {
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
    var settings = options.settings || {};
    var maxAttempts = Number.isFinite(options.maxAttempts) ? options.maxAttempts : DEFAULT_MAX_ATTEMPTS;
    var startupTimeoutMs = Number.isFinite(options.startupTimeoutMs)
      ? options.startupTimeoutMs
      : DEFAULT_STARTUP_TIMEOUT_MS;
    var schedule = options.setTimeout || function (fn, ms) { return setTimeout(fn, ms); };
    var cancelTimer = options.clearTimeout || function (handle) { clearTimeout(handle); };
    var onChange = typeof options.onChange === "function" ? options.onChange : function () {};
    var startAttempt = typeof options.onAttempt === "function" ? options.onAttempt : null;

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
        startedAt: attemptCounter
      };
      currentAttempt = attempt;
      triedIds.push(candidate.id);
      state = STATE.STARTING;
      // `lastFailure` deliberately survives into the next attempt so the UI can
      // show which source failed while the replacement is starting. It is
      // cleared once something actually plays.

      clearStartupTimer();
      timeoutHandle = schedule(function () {
        timeoutHandle = null;
        report(attempt.id, "error", { type: FAILURE.TIMEOUT });
      }, startupTimeoutMs);

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
    }

    function failCurrent(failureKind, detail) {
      var attempt = currentAttempt;
      var failedCandidate = attempt ? attempt.candidate : null;
      finishAttempt(attempt);
      lastFailure = {
        kind: failureKind,
        text: describeFailure(failureKind),
        detail: detail || "",
        candidate: failedCandidate,
        afterPlayback: hasMeaningfulPlayback
      };

      // Never auto-switch once real playback happened: that is a user decision.
      var mayFailover =
        !hasMeaningfulPlayback && settings.autoFailover !== false && triedIds.length < maxAttempts;
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

      if (event === "ready") {
        clearStartupTimer();
        state = STATE.PLAYING;
        lastFailure = null;
        emit();
        return true;
      }

      if (event === "progress") {
        var seconds = Number(detail && detail.currentTime);
        if (Number.isFinite(seconds)) {
          resumeTime = seconds;
          if (seconds >= MEANINGFUL_PLAYBACK_SECONDS && !hasMeaningfulPlayback) {
            hasMeaningfulPlayback = true;
            emit();
          }
        }
        return true;
      }

      if (event === "error") {
        failCurrent(classifyFailure(detail), (detail && (detail.detail || detail.message)) || "");
        return true;
      }

      return false;
    }

    function start() {
      if (cancelled) return snapshot();
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
    classifyFailure: classifyFailure,
    describeFailure: describeFailure,
    createSession: createSession
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
