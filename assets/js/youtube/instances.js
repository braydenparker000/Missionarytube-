/**
 * Invidious instance selection and failover.
 *
 * A public Invidious instance is a volunteer server that can be slow, rate
 * limited, rebuilding, or simply gone. Treating any single one as "the API"
 * is what makes browser-only YouTube clients feel broken, so this module owns
 * the whole question of *which server answers*:
 *
 *   - every instance carries measured health: latency, failures, cooldown
 *   - a request that fails on one instance is retried on another, bounded
 *   - a failing instance is put on a cooldown instead of being hammered
 *   - a cooled instance recovers by itself once the cooldown elapses
 *   - the instance that answered is pinned for the session, so a working
 *     server is not re-raced on every keystroke
 *
 * Availability probing is deliberately non-blocking: the first real request
 * goes straight to the preferred instance while the probe fills in health for
 * the rest. Nothing in the UI ever waits for a full sweep.
 *
 * `fetch`, the clock and the timers are injected, so the same code runs in the
 * browser and under node:vm in the tests.
 */
(function (global) {
  "use strict";

  var STATE = { UNKNOWN: "unknown", HEALTHY: "healthy", UNHEALTHY: "unhealthy" };

  /**
   * Why an attempt failed. `content` is the one category that is *not* the
   * instance's fault — an age-restricted or removed video answers identically
   * everywhere — so it never costs an instance its health and never triggers a
   * pointless retry somewhere else.
   */
  var FAILURE = {
    TIMEOUT: "timeout",
    NETWORK: "network",
    FORBIDDEN: "forbidden",
    RATE_LIMITED: "rate-limited",
    SERVER: "server",
    MALFORMED: "malformed",
    NOT_FOUND: "not-found",
    CONTENT: "content",
    NO_INSTANCE: "no-instance",
    ABORTED: "aborted"
  };

  var FAILURE_TEXT = {
    timeout: "The Invidious server did not answer in time.",
    network: "The Invidious server could not be reached.",
    forbidden: "The Invidious server refused the request.",
    "rate-limited": "The Invidious server is rate limiting requests.",
    server: "The Invidious server reported an internal error.",
    malformed: "The Invidious server returned an unusable response.",
    "not-found": "The Invidious server does not offer that endpoint.",
    content: "YouTube would not return this video.",
    "no-instance": "No Invidious server is currently available.",
    aborted: "The request was cancelled."
  };

  /**
   * How each protocol is asked "are you alive". Piped has no universally
   * present status endpoint, so trending stands in: it is a real call that
   * proves the instance can both answer and reach YouTube, which a static
   * health page would not.
   */
  var PROBE = {
    invidious: {
      path: "/api/v1/stats",
      params: null,
      validate: function (body) {
        return !!body && typeof body === "object" && !!(body.software || body.version || body.usage);
      }
    },
    piped: {
      path: "/trending",
      params: { region: "US" },
      validate: function (body) {
        return Array.isArray(body);
      }
    }
  };

  // A rate limit is a request to back off, so it earns a longer rest than a
  // one-off error does.
  var COOLDOWN_MULTIPLIER = { "rate-limited": 4, forbidden: 2 };
  var MAX_BACKOFF_STEPS = 4;

  function describeFailure(kind) {
    return FAILURE_TEXT[kind] || FAILURE_TEXT.network;
  }

  /** A typed error every caller can branch on without string matching. */
  function providerError(kind, message, extra) {
    var error = new Error(message || describeFailure(kind));
    error.name = "InvidiousError";
    error.kind = kind;
    error.provider = "invidious";
    if (extra && typeof extra === "object") {
      if (extra.instance) error.instance = extra.instance;
      if (extra.status) error.status = extra.status;
      if (extra.attempts) error.attempts = extra.attempts;
    }
    return error;
  }

  function isAbortError(error) {
    if (!error) return false;
    return error.name === "AbortError" || error.kind === FAILURE.ABORTED;
  }

  /**
   * Map an HTTP status onto a failure category. A 404 is ambiguous — a wrong
   * route and a missing video look the same — so the body decides, and this
   * only reports what the status alone can support.
   */
  function classifyStatus(status) {
    var code = Number(status) || 0;
    if (code === 429) return FAILURE.RATE_LIMITED;
    if (code === 403 || code === 401) return FAILURE.FORBIDDEN;
    if (code === 404 || code === 410) return FAILURE.NOT_FOUND;
    if (code >= 500) return FAILURE.SERVER;
    return FAILURE.SERVER;
  }

  /**
   * Invidious reports an unplayable video as a JSON body with an `error`
   * string, sometimes under a 200 and sometimes under a 4xx/5xx. Recognising
   * that shape is what stops a removed video from being blamed on the server
   * and retried across every instance in the list.
   */
  function contentErrorMessage(body) {
    if (!body || typeof body !== "object") return "";
    var message = body.error || body.errorMessage;
    if (typeof message !== "string" || !message.trim()) return "";
    // Resolver exceptions are not evidence that a video itself is restricted.
    // Preserve failover for outages, extraction errors and timeouts.
    if (!/^(?:this video is unavailable[.!]?|video unavailable[.!]?)$|(?:video (?:has been|was) (?:removed|deleted)|private video|video is private|age[- ]restricted|not available in your country|copyright claim)/i.test(message.trim())) return "";
    return message.trim().slice(0, 200);
  }

  function nowFn(options) {
    return typeof options.now === "function" ? options.now : function () { return Date.now(); };
  }

  /**
   * Create the manager for one resolved configuration.
   *
   * The health table is keyed by instance URL and lives for the session, so
   * repeated searches reuse what the first one learned.
   */
  function createManager(options) {
    var config = options.config;
    var list = (options.instances || []).slice();
    var fetchImpl = options.fetch;
    var now = nowFn(options);
    var schedule = options.setTimeout || function (fn, ms) { return setTimeout(fn, ms); };
    var cancelTimer = options.clearTimeout || function (handle) { clearTimeout(handle); };
    var Controller = options.AbortController || global.AbortController;

    var health = {};
    list.forEach(function (entry, index) {
      health[entry.url] = {
        url: entry.url,
        kind: entry.kind,
        api: entry.api || "invidious",
        order: index,
        state: STATE.UNKNOWN,
        latency: 0,
        failures: 0,
        successes: 0,
        requests: 0,
        cooldownUntil: 0,
        lastChecked: 0,
        lastError: ""
      };
    });

    var pinned = "";
    var probing = null;

    function record(url) {
      return health[url] || null;
    }

    function cooling(entry) {
      return !!entry && entry.cooldownUntil > now();
    }

    /** A cooldown that has elapsed returns the instance to the unknown pool. */
    function recoverExpired() {
      var moment = now();
      Object.keys(health).forEach(function (url) {
        var entry = health[url];
        if (entry.state !== STATE.UNHEALTHY || entry.cooldownUntil > moment) return;
        entry.state = STATE.UNKNOWN;
        entry.cooldownUntil = 0;
      });
    }

    /**
     * `pin` is what separates a real request from a probe. Answering a probe
     * proves an instance is alive; it does not earn the session, because a
     * background sweep finishing in an arbitrary order must not decide which
     * server the next search goes to. Measured latency decides that.
     */
    function markHealthy(url, latency, pin) {
      var entry = record(url);
      if (!entry) return;
      entry.state = STATE.HEALTHY;
      entry.latency = Math.max(1, Math.round(latency));
      entry.failures = 0;
      entry.successes += 1;
      entry.requests += 1;
      entry.cooldownUntil = 0;
      entry.lastChecked = now();
      entry.lastError = "";
      if (pin) pinned = url;
    }

    function markUnhealthy(url, kind) {
      var entry = record(url);
      if (!entry) return;
      entry.state = STATE.UNHEALTHY;
      entry.failures += 1;
      entry.requests += 1;
      entry.lastChecked = now();
      entry.lastError = kind;
      var steps = Math.min(MAX_BACKOFF_STEPS, entry.failures);
      var multiplier = COOLDOWN_MULTIPLIER[kind] || 1;
      entry.cooldownUntil = now() + config.instanceCooldown * steps * multiplier;
      if (pinned === url) pinned = "";
    }

    /**
     * Candidate order for one request.
     *
     * The private instance leads whenever it is not resting, because the
     * public ones are fallbacks and nothing else: once ours has served its
     * cooldown it takes the work back rather than waiting for the stand-in to
     * fail too. Among the fallbacks the pinned one leads, since it answered
     * last time, then healthy ones by measured latency, then never-tried ones
     * in declared order. Resting instances are excluded entirely, which is the
     * whole point of a cooldown.
     */
    function orderedRecords() {
      recoverExpired();
      var available = Object.keys(health)
        .map(function (url) { return health[url]; })
        .filter(function (entry) { return !cooling(entry); });

      return available
        .slice()
        .sort(function (a, b) {
          var aPrivate = a.kind === "private";
          var bPrivate = b.kind === "private";
          if (aPrivate !== bPrivate) return aPrivate ? -1 : 1;
          if (a.url === pinned) return -1;
          if (b.url === pinned) return 1;
          var aHealthy = a.state === STATE.HEALTHY;
          var bHealthy = b.state === STATE.HEALTHY;
          if (aHealthy !== bHealthy) return aHealthy ? -1 : 1;
          if (aHealthy && bHealthy && a.latency !== b.latency) return a.latency - b.latency;
          return a.order - b.order;
        })
        .map(function (entry) {
          return { url: entry.url, api: entry.api, kind: entry.kind };
        });
    }

    /** The same order, as bare URLs, for callers that only need the address. */
    function order() {
      return orderedRecords().map(function (entry) { return entry.url; });
    }

    /** The instance media URLs should be built against right now. */
    function preferred() {
      var candidates = order();
      return candidates.length ? candidates[0] : "";
    }

    function buildUrl(instance, path, params) {
      var url = instance + (path.charAt(0) === "/" ? path : "/" + path);
      var query = [];
      Object.keys(params || {}).forEach(function (key) {
        var value = params[key];
        if (value == null || value === "") return;
        query.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
      });
      return query.length ? url + "?" + query.join("&") : url;
    }

    /**
     * One attempt against one instance. Resolves with the parsed body, or
     * rejects with a typed error naming the category and the instance.
     */
    function attempt(instance, path, params, settings) {
      var timeout = settings.timeout || config.requestTimeout;
      var controller = Controller ? new Controller() : null;
      var timedOut = false;
      var started = now();
      var handle = null;
      var unlink = null;

      if (controller) {
        handle = schedule(function () {
          timedOut = true;
          try {
            controller.abort();
          } catch (error) {
            /* an already-aborted controller is fine */
          }
        }, timeout);

        // A caller cancelling (a new keystroke, a closed sheet) must abort the
        // in-flight request without being mistaken for an instance failure.
        if (settings.signal) {
          if (settings.signal.aborted) {
            cancelTimer(handle);
            return Promise.reject(providerError(FAILURE.ABORTED, "The request was cancelled."));
          }
          var onAbort = function () {
            try {
              controller.abort();
            } catch (error) {
              /* nothing to release */
            }
          };
          settings.signal.addEventListener("abort", onAbort);
          unlink = function () { settings.signal.removeEventListener("abort", onAbort); };
        }
      }

      function done() {
        if (handle !== null) cancelTimer(handle);
        if (unlink) unlink();
      }

      return Promise.resolve()
        .then(function () {
          return fetchImpl(buildUrl(instance, path, params), {
            method: "GET",
            mode: "cors",
            credentials: "omit",
            redirect: "follow",
            referrerPolicy: "no-referrer",
            headers: { accept: "application/json" },
            signal: controller ? controller.signal : undefined
          });
        })
        .then(function (response) {
          if (!response) throw providerError(FAILURE.MALFORMED, "", { instance: instance });
          return response.text().then(function (text) {
            var body = null;
            var parsed = true;
            try {
              body = text ? JSON.parse(text) : null;
            } catch (error) {
              parsed = false;
            }

            // A recognisable content error is the video's problem, not the
            // server's, whatever status it arrived under.
            var contentMessage = parsed ? contentErrorMessage(body) : "";
            if (contentMessage) {
              throw providerError(FAILURE.CONTENT, contentMessage, {
                instance: instance,
                status: response.status
              });
            }

            if (response.ok === false || (response.status && response.status >= 400)) {
              throw providerError(classifyStatus(response.status), "", {
                instance: instance,
                status: response.status
              });
            }
            // Some backends encode server failures in an HTTP 200 response.
            if (parsed && body && (body.error || body.errorMessage)) {
              throw providerError(FAILURE.SERVER, "", { instance: instance });
            }
            if (!parsed || body == null) {
              throw providerError(FAILURE.MALFORMED, "", { instance: instance });
            }
            if (typeof settings.validate === "function" && !settings.validate(body)) {
              throw providerError(FAILURE.MALFORMED, "", { instance: instance });
            }
            return { body: body, latency: now() - started, instance: instance };
          });
        })
        .then(
          function (result) {
            done();
            return result;
          },
          function (error) {
            done();
            if (error && error.kind) throw error;
            if (timedOut) throw providerError(FAILURE.TIMEOUT, "", { instance: instance });
            if (isAbortError(error)) throw providerError(FAILURE.ABORTED, "The request was cancelled.");
            throw providerError(FAILURE.NETWORK, "", { instance: instance });
          }
        );
    }

    /**
     * Run one logical request, moving to another instance when an instance
     * fails. The attempt budget is what keeps this bounded: there is no
     * scenario in which this retries forever.
     *
     * `describe` is either a path, or a function called with the instance
     * record for each attempt. The function form is what lets one logical
     * request cross protocols: the same "fetch this video" asks a Piped
     * instance for `/streams/ID` and an Invidious one for `/api/v1/videos/ID`,
     * and the caller finds out which answered from `api` on the result.
     */
    function request(describe, options) {
      var settings = options || {};
      var candidates = orderedRecords();
      if (!candidates.length) {
        return Promise.reject(providerError(FAILURE.NO_INSTANCE, "", { attempts: 0 }));
      }
      var budget = Math.min(candidates.length, config.maxAttempts);
      var index = 0;
      var attempts = 0;
      var lastError = null;

      function specFor(record) {
        if (typeof describe !== "function") {
          return { path: describe, params: settings.params, validate: settings.validate };
        }
        var spec = describe(record) || {};
        return {
          path: spec.path,
          params: spec.params === undefined ? settings.params : spec.params,
          validate: spec.validate === undefined ? settings.validate : spec.validate
        };
      }

      function next() {
        if (settings.signal && settings.signal.aborted) {
          return Promise.reject(providerError(FAILURE.ABORTED, "The request was cancelled."));
        }
        if (index >= candidates.length || attempts >= budget) {
          throw lastError || providerError(FAILURE.NO_INSTANCE, "", { attempts: attempts });
        }
        var record = candidates[index];
        index += 1;
        var spec = specFor(record);
        // An instance whose protocol cannot serve this request is skipped
        // rather than counted against the budget.
        if (!spec.path) return next();
        attempts += 1;
        return attempt(record.url, spec.path, spec.params, {
          timeout: settings.timeout,
          signal: settings.signal,
          validate: spec.validate
        }).then(
          function (result) {
            markHealthy(record.url, result.latency, true);
            return {
              data: result.body,
              instance: record.url,
              api: record.api,
              latency: result.latency,
              attempts: attempts
            };
          },
          function (error) {
            // Cancellation and a genuinely unavailable video both end the
            // request here: another server would answer exactly the same.
            if (error.kind === FAILURE.ABORTED || error.kind === FAILURE.CONTENT) throw error;
            markUnhealthy(record.url, error.kind);
            error.attempts = attempts;
            lastError = error;
            return next();
          }
        );
      }

      return Promise.resolve().then(next);
    }

    /**
     * Fill in health for instances we have not used yet.
     *
     * Every instance is probed in parallel and the result is only recorded, so
     * this can run beside real work rather than in front of it. Callers are
     * not expected to await it.
     */
    function probe(options) {
      var settings = options || {};
      if (probing && !settings.force) return probing;
      recoverExpired();
      var targets = Object.keys(health).filter(function (url) {
        var entry = health[url];
        if (settings.force) return true;
        return entry.state === STATE.UNKNOWN && !cooling(entry);
      });
      if (!targets.length) return Promise.resolve(snapshot());

      probing = Promise.all(
        targets.map(function (url) {
          var spec = PROBE[health[url].api] || PROBE.invidious;
          return attempt(url, spec.path, spec.params, {
            timeout: config.probeTimeout,
            validate: spec.validate
          }).then(
            function (result) {
              markHealthy(url, result.latency);
            },
            function (error) {
              if (error.kind === FAILURE.ABORTED) return;
              markUnhealthy(url, error.kind);
            }
          );
        })
      ).then(function () {
        probing = null;
        return snapshot();
      });

      return probing;
    }

    /** Owner-initiated recovery: clear every cooldown and re-probe. */
    function reset() {
      Object.keys(health).forEach(function (url) {
        var entry = health[url];
        entry.state = STATE.UNKNOWN;
        entry.cooldownUntil = 0;
        entry.failures = 0;
        entry.lastError = "";
      });
      pinned = "";
      probing = null;
      return probe({ force: true });
    }

    function snapshot() {
      var moment = now();
      return {
        pinned: pinned,
        preferred: preferred(),
        instances: Object.keys(health)
          .map(function (url) {
            var entry = health[url];
            return {
              url: entry.url,
              kind: entry.kind,
              api: entry.api,
              state: entry.cooldownUntil > moment ? STATE.UNHEALTHY : entry.state,
              latency: entry.latency,
              failures: entry.failures,
              successes: entry.successes,
              requests: entry.requests,
              cooldownMs: Math.max(0, entry.cooldownUntil - moment),
              lastChecked: entry.lastChecked,
              lastError: entry.lastError
            };
          })
          .sort(function (a, b) { return health[a.url].order - health[b.url].order; })
      };
    }

    return {
      STATE: STATE,
      request: request,
      probe: probe,
      reset: reset,
      order: order,
      orderedRecords: orderedRecords,
      preferred: preferred,
      buildUrl: buildUrl,
      snapshot: snapshot,
      get pinned() {
        return pinned;
      }
    };
  }

  global.AstraYouTube = global.AstraYouTube || {};
  global.AstraYouTube.instances = {
    STATE: STATE,
    FAILURE: FAILURE,
    FAILURE_TEXT: FAILURE_TEXT,
    describeFailure: describeFailure,
    providerError: providerError,
    classifyStatus: classifyStatus,
    contentErrorMessage: contentErrorMessage,
    isAbortError: isAbortError,
    createManager: createManager
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
