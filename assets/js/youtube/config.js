/**
 * The one place the YouTube backends are configured.
 *
 * Every instance URL, timeout and cooldown the provider uses is declared here.
 * Nothing else in the codebase may hard-code an instance host, so changing
 * where YouTube is resolved from is a single-list change.
 *
 * Two protocols are spoken, because in practice availability is the whole
 * game and no single instance stays up:
 *
 *   piped       Piped's API. Its own frontend is a separate-origin static
 *               app, so the API is CORS-enabled by design - which is exactly
 *               what a static site on Azure Storage needs. Stream URLs come
 *               back already proxied by the instance, so they carry CORS and
 *               are not bound to the address that resolved them.
 *   invidious   Invidious' API, kept as a last resort.
 *
 * The list is Piped-first because that is what measurably answers. Order here
 * is only a starting hint: measured health decides afterwards.
 *
 * A private instance is deliberately empty in the repository. It is the
 * owner's own server, it is set at runtime from Settings, and committing it
 * would publish a private address.
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
     * Our own deployment, if there ever is one, e.g. "https://piped.example.org".
     * Set it in Settings → YouTube, or hard-code it here for a private fork.
     * See deploy/invidious/ for one server this can be.
     */
    privateInstanceUrl: "",

    /** Which protocol the private instance speaks. */
    privateInstanceApi: "piped",

    /**
     * Astra's edge relay leads because it is the only shipped backend whose
     * search and muxed playback path we control end to end. Public Piped and
     * Invidious instances remain bounded fallbacks for availability.
     *
     * The entries after Astra's relay are volunteer infrastructure. The app
     * asks them for only a few kilobytes of JSON and rests any that fail.
     */
    publicFallbackInstances: [
      { url: "https://astra-youtube-relay.braydenparker999.chatgpt.site/api/youtube", api: "piped" },
      { url: "https://api.piped.private.coffee", api: "piped" },
      { url: "https://pipedapi.ducks.party", api: "piped" },
      { url: "https://api.piped.yt", api: "piped" },
      { url: "https://api.piped.privacydev.net", api: "piped" },
      { url: "https://pipedapi.reallyaweso.me", api: "piped" },
      { url: "https://pipedapi.kavin.rocks", api: "piped" },
      { url: "https://pipedapi.adminforge.de", api: "piped" },
      { url: "https://pipedapi.leptons.xyz", api: "piped" },
      { url: "https://pipedapi.nosebs.ru", api: "piped" },
      { url: "https://yewtu.be", api: "invidious" },
      { url: "https://inv.nadeko.net", api: "invidious" },
      { url: "https://invidious.nerdvpn.de", api: "invidious" }
    ],

    /** How long any single backend request may take before it is abandoned. */
    requestTimeout: 25000,

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

  var MAX_INSTANCES = 16;
  var PROTOCOLS = ["piped", "invidious"];

  function protocol(value) {
    var wanted = str(value).trim().toLowerCase();
    return PROTOCOLS.indexOf(wanted) === -1 ? "piped" : wanted;
  }

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

  /**
   * Accept either a bare URL string or a `{ url, api }` pair, and always
   * return the pair. A bare string is assumed to be Piped, because that is
   * what the pool is made of and what a person pasting an address today is
   * most likely to have.
   */
  function normalizeEntry(value) {
    var raw = value && typeof value === "object" ? value : { url: value };
    var url = normalizeInstance(raw.url);
    if (!url) return null;
    return { url: url, api: protocol(raw.api) };
  }

  function uniqueInstances(list) {
    var seen = {};
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (value) {
      var entry = normalizeEntry(value);
      if (!entry || seen[entry.url] || out.length >= MAX_INSTANCES) return;
      seen[entry.url] = true;
      out.push(entry);
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
      given.privateInstanceUrl == null ? DEFAULTS.privateInstanceUrl : given.privateInstanceUrl
    );
    var privateApi = protocol(given.privateInstanceApi == null ? DEFAULTS.privateInstanceApi : given.privateInstanceApi);
    var fallbacks = uniqueInstances(
      Array.isArray(given.publicFallbackInstances) && given.publicFallbackInstances.length
        ? given.publicFallbackInstances
        : DEFAULTS.publicFallbackInstances
    ).filter(function (entry) {
      return entry.url !== privateUrl;
    });

    var preferAdaptive = given.preferAdaptive;
    if (preferAdaptive !== true && preferAdaptive !== false) preferAdaptive = !!privateUrl;

    return Object.freeze({
      enabled: given.enabled !== false,
      privateInstanceUrl: privateUrl,
      privateInstanceApi: privateApi,
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
    if (resolved.privateInstanceUrl) {
      list.push({ url: resolved.privateInstanceUrl, api: resolved.privateInstanceApi, kind: "private" });
    }
    resolved.publicFallbackInstances.forEach(function (entry) {
      list.push({ url: entry.url, api: entry.api, kind: "public" });
    });
    return list;
  }

  /** Only the owner's own settings are persisted; the rest are code defaults. */
  function storable(config) {
    var resolved = config && config.publicFallbackInstances ? config : resolve(config);
    return {
      enabled: resolved.enabled,
      privateInstanceUrl: resolved.privateInstanceUrl,
      privateInstanceApi: resolved.privateInstanceApi,
      preferAdaptive: resolved.preferAdaptive,
      maxHeight: resolved.maxHeight
    };
  }

  global.AstraYouTube = global.AstraYouTube || {};
  global.AstraYouTube.config = {
    DEFAULTS: DEFAULTS,
    MAX_INSTANCES: MAX_INSTANCES,
    PROTOCOLS: PROTOCOLS,
    protocol: protocol,
    normalizeInstance: normalizeInstance,
    normalizeEntry: normalizeEntry,
    describeInstanceProblem: describeInstanceProblem,
    uniqueInstances: uniqueInstances,
    resolve: resolve,
    instanceList: instanceList,
    storable: storable
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
