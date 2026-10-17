/** Browser fetch policy for add-on headers. Values stay in memory, never diagnostics. */
(function (global) {
  "use strict";

  // Fetch forbids these; Chrome also silently drops User-Agent overrides.
  var FORBIDDEN = /^(?:accept-charset|accept-encoding|access-control-request-headers|access-control-request-method|connection|content-length|cookie2?|date|dnt|expect|host|keep-alive|origin|permissions-policy|referer|referrer|set-cookie|te|trailer|transfer-encoding|upgrade|user-agent|via|x-http-method(?:-override)?|x-method-override)$/i;
  var TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

  function object(value) { return value && typeof value === "object" && !Array.isArray(value); }
  function analyze(url, hints) {
    var policy = { required: false, supported: true, headers: {}, origin: "", blockedReasons: [] };
    try { policy.origin = new URL(url).origin; } catch (error) { /* URL validation belongs to stream normalization. */ }
    if (hints == null) return policy;
    function block(code) {
      policy.required = true;
      policy.supported = false;
      if (policy.blockedReasons.indexOf(code) === -1) policy.blockedReasons.push(code);
    }
    if (!object(hints)) { block("invalid-headers"); return policy; }
    if (hints.response != null && (!object(hints.response) || Object.keys(hints.response).length)) block("response-headers");
    if (hints.request == null) return policy;
    if (!object(hints.request)) { block("invalid-headers"); return policy; }
    Object.keys(hints.request).forEach(function (name) {
      var key = name.toLowerCase();
      var value = hints.request[name];
      policy.required = true;
      if (!TOKEN.test(name) || typeof value !== "string" || /[^\t\x20-\x7e\x80-\xff]/.test(value)) { block("invalid-headers"); return; }
      if (FORBIDDEN.test(key) || /^(?:proxy-|sec-)/i.test(key)) { block("browser-controlled-headers"); return; }
      if (Object.prototype.hasOwnProperty.call(policy.headers, key) && policy.headers[key] !== value) { block("invalid-headers"); return; }
      Object.defineProperty(policy.headers, key, { value: value, enumerable: true, writable: true, configurable: true });
    });
    if (policy.required && (!policy.origin || policy.origin === "null")) block("invalid-header-origin");
    return policy;
  }

  function error() {
    var result = new Error("This source requires a media server to apply its access requirements.");
    result.playbackType = "access";
    return result;
  }

  function fetchInit(policy, target, init) {
    var result = Object.assign({}, init || {});
    if (!policy || !policy.required) return result;
    if (!policy.supported) throw error();
    var parsed;
    try { parsed = new URL(typeof target === "string" ? target : target.url || target.href); } catch (ignored) { throw error(); }
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) throw error();
    var headers = new Headers(result.headers || {});
    var range = headers.get("range");
    // A playlist may point to another CDN. Never forward add-on credentials
    // there, including headers left in an inherited request init object.
    Object.keys(policy.headers).forEach(function (name) { headers.delete(name); });
    if (parsed.origin === policy.origin) {
      Object.keys(policy.headers).forEach(function (name) { headers.set(name, policy.headers[name]); });
    }
    // The demuxer's actual byte range must win over an add-on's fixed range,
    // including when a playlist segment lives on another CDN.
    if (range !== null) headers.set("range", range);
    result.headers = headers;
    result.credentials = "omit";
    result.mode = "cors";
    // XHR automatically follows redirects and can leak arbitrary custom
    // headers. Fetch must reject them before any second request is sent.
    result.redirect = parsed.origin === policy.origin ? "error" : "follow";
    return result;
  }

  global.AstraPlayback = global.AstraPlayback || {};
  global.AstraPlayback.requests = { analyze: analyze, fetchInit: fetchInit, error: error };
})(typeof globalThis !== "undefined" ? globalThis : this);
