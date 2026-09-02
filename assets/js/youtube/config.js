/**
 * The one place Invidious is configured.
 *
 * Every instance URL, timeout and cooldown the YouTube provider uses is
 * declared here. Nothing else in the codebase may hard-code an instance host,
 * so moving to a different private server is a single-value change.
 *
 * The private instance is deliberately empty in the repository. It is the
 * owner's own server, it is set at runtime from Settings, and committing it
 * would publish a private address. When it is unset the provider still works
 * through the public fallbacks, with adaptive playback disabled by default
 * because most public instances refuse to proxy video data.
 *
 * Loaded as a classic browser script and through node:vm in the tests.
 */
(function (global) {
  "use strict";

  /* ------------------------------------------------------------------ *
   * CONFIGURATION
   * ------------------------------------------------------------------ */

  var DEFAULTS = {
    /**
     * Our own Invidious deployment, e.g. "https://invidious.example.org".
     * Set it in Settings → YouTube, or hard-code it here for a private fork.
     * See deploy/invidious/ for the server this expects.
     */
    privateInvidiousUrl: "",

    /**
     * Public instances, used only when the private one is unset, unhealthy or
     * slow. Order is a starting hint; measured latency decides afterwards.
     */
    publicFallbackInstances: [
      "https://yewtu.be",
      "https://inv.nadeko.net",
      "https://invidious.nerdvpn.de"
    ],

    /** How long any single Invidious request may take before it is abandoned. */
    requestTimeout: 9000,

    /** How long a failing instance is left alone before it is tried again. */
    instanceCooldown: 120000,

    /** A cheap availability probe gets less patience than a real request. */
    probeTimeout: 4000,

    /** Total instances one logical request may try before it gives up. */
    maxAttempts: 3,

    /** How long a successful API response may be reused. */
    cacheTtl: 300000,

    /**
     * Route adaptive playback (DASH) through the selected instance.
     *
     * Adaptive streams are fetched by JavaScript through Media Source
     * Extensions, so they need CORS headers that Google's video hosts do not
     * send. The instance proxy is the only way to satisfy that, which is why
     * this is on for a private instance and off for public ones: a public
     * instance is somebody else's bandwidth, and most of them disable the
     * proxy anyway.
     */
    preferAdaptive: null,

    /** Cap the adaptive ladder so a phone is never handed a 4K representation. */
    maxHeight: 1080
  };

  var MAX_INSTANCES = 8;

  function str(value) {
    return value == null ? "" : String(value);
  }

  function clampNumber(value, fallback, low, high) {
    var number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(high, Math.max(low, Math.round(number)));
  }

  /**
   * Accept an instance URL only if it is an https origin with no path, query
   * or credentials. Anything else is a configuration mistake or an attempt to
   * smuggle a different endpoint in, and both should fail loudly rather than
   * be half-honoured.
   */
  function normalizeInstance(value) {
    var raw = str(value).trim();
    if (!raw) return "";
    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
    var parsed;
    try {
      parsed = new URL(raw);
    } catch (error) {
      return "";
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    if (parsed.username || parsed.password) return "";
    if (parsed.search || parsed.hash) return "";
    var path = parsed.pathname.replace(/\/+$/, "");
    return parsed.protocol + "//" + parsed.host + path;
  }

  /** Why a pasted instance URL was rejected, in words a person can act on. */
  function describeInstanceProblem(value) {
    var raw = str(value).trim();
    if (!raw) return "Paste your Invidious server's address.";
    if (normalizeInstance(raw)) return "";
    if (/\s/.test(raw)) return "An address cannot contain spaces.";
    if (/[?#]/.test(raw)) return "Use the plain server address, with no query string or fragment.";
    if (/@/.test(raw)) return "Remove the username and password from the address.";
    return "That is not a valid https server address.";
  }

  function uniqueInstances(list) {
    var seen = {};
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (value) {
      var normalized = normalizeInstance(value);
      if (!normalized || seen[normalized] || out.length >= MAX_INSTANCES) return;
      seen[normalized] = true;
      out.push(normalized);
    });
    return out;
  }

  /**
   * Merge stored owner preferences over the defaults and return a frozen,
   * fully validated configuration. Callers never see a half-valid object.
   */
  function resolve(overrides) {
    var given = overrides && typeof overrides === "object" ? overrides : {};
    var privateUrl = normalizeInstance(
      given.privateInvidiousUrl == null ? DEFAULTS.privateInvidiousUrl : given.privateInvidiousUrl
    );
    var fallbacks = uniqueInstances(
      Array.isArray(given.publicFallbackInstances) && given.publicFallbackInstances.length
        ? given.publicFallbackInstances
        : DEFAULTS.publicFallbackInstances
    ).filter(function (url) {
      return url !== privateUrl;
    });

    var preferAdaptive = given.preferAdaptive;
    if (preferAdaptive !== true && preferAdaptive !== false) preferAdaptive = !!privateUrl;

    return Object.freeze({
      enabled: given.enabled !== false,
      privateInvidiousUrl: privateUrl,
      publicFallbackInstances: Object.freeze(fallbacks),
      requestTimeout: clampNumber(given.requestTimeout, DEFAULTS.requestTimeout, 2000, 30000),
      instanceCooldown: clampNumber(given.instanceCooldown, DEFAULTS.instanceCooldown, 5000, 3600000),
      probeTimeout: clampNumber(given.probeTimeout, DEFAULTS.probeTimeout, 1000, 15000),
      maxAttempts: clampNumber(given.maxAttempts, DEFAULTS.maxAttempts, 1, 5),
      cacheTtl: clampNumber(given.cacheTtl, DEFAULTS.cacheTtl, 0, 3600000),
      preferAdaptive: preferAdaptive,
      maxHeight: clampNumber(given.maxHeight, DEFAULTS.maxHeight, 360, 2160)
    });
  }

  /**
   * The ordered instance list for a configuration. The private instance always
   * leads: it is the one we control, the one with the proxy enabled, and the
   * only one whose availability is our own responsibility.
   */
  function instanceList(config) {
    var resolved = config && config.publicFallbackInstances ? config : resolve(config);
    var list = [];
    if (resolved.privateInvidiousUrl) {
      list.push({ url: resolved.privateInvidiousUrl, kind: "private" });
    }
    resolved.publicFallbackInstances.forEach(function (url) {
      list.push({ url: url, kind: "public" });
    });
    return list;
  }

  /** Only the owner's own settings are persisted; the rest are code defaults. */
  function storable(config) {
    var resolved = config && config.publicFallbackInstances ? config : resolve(config);
    return {
      enabled: resolved.enabled,
      privateInvidiousUrl: resolved.privateInvidiousUrl,
      preferAdaptive: resolved.preferAdaptive,
      maxHeight: resolved.maxHeight
    };
  }

  global.AstraYouTube = global.AstraYouTube || {};
  global.AstraYouTube.config = {
    DEFAULTS: DEFAULTS,
    MAX_INSTANCES: MAX_INSTANCES,
    normalizeInstance: normalizeInstance,
    describeInstanceProblem: describeInstanceProblem,
    uniqueInstances: uniqueInstances,
    resolve: resolve,
    instanceList: instanceList,
    storable: storable
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
