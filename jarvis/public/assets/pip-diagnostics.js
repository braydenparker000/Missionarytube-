/* Read-only PiP evidence. Chrome owns the native window and the Web API does
   not identify whether a native close, remove, or expand control was used.
   Keep only bounded, allowlisted state in memory; never store media URLs,
   titles, credentials, raw user agents, or errors. */
(function(global) {
  'use strict';
  const intents = ['app-enter', 'app-exit', 'media-stop'];
  const outcomes = ['enter-resolved', 'enter-rejected', 'exit-resolved', 'exit-rejected', 'system-unavailable', 'attempt-dispose', 'player-dispose'];
  const apps = ['mymedia', 'astra'];
  const version = value => /^\d+(?:\.\d+){0,3}$/.test(String(value || '')) ? String(value) : 'unknown';
  const safeCall = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

  function observe(media, options = {}) {
    const doc = options.document || global.document;
    const win = options.window || global;
    const nav = options.navigator || global.navigator || {};
    const now = options.now || (() => global.performance?.now?.() ?? Date.now());
    const began = now(), events = [], listeners = [];
    let disposed = false, sequence = 0, lastExit = null;
    let active = doc?.pictureInPictureElement === media;
    const clock = () => Math.max(0, Math.round((now() - began) / 10) * 10);
    const state = () => ({
      visibility: doc?.visibilityState === 'visible' ? 'visible' : doc?.visibilityState === 'hidden' ? 'hidden' : 'unknown',
      focused: !!safeCall(() => doc.hasFocus(), false),
      pipEventActive: active,
      pipElement: doc?.pictureInPictureElement === media,
      fullscreen: !!doc?.fullscreenElement,
      mediaFullscreen: doc?.fullscreenElement === media,
      paused: media?.paused !== false,
      ended: media?.ended === true,
      readyState: Number.isInteger(media?.readyState) && media.readyState >= 0 && media.readyState <= 4 ? media.readyState : 0
    });
    function record(event) {
      if (disposed) return;
      const entry = {sequence: ++sequence, milliseconds: clock(), event, ...state()};
      events.push(entry);
      if (event === 'leavepictureinpicture') lastExit = {...entry};
      if (events.length > 48) events.shift();
    }
    function listen(target, event, callback) {
      if (!target?.addEventListener) return;
      const fn = callback || (() => record(event));
      target.addEventListener(event, fn);
      listeners.push(() => target.removeEventListener(event, fn));
    }
    listen(media, 'enterpictureinpicture', () => { active = true; record('enterpictureinpicture'); });
    listen(media, 'leavepictureinpicture', () => { active = false; record('leavepictureinpicture'); });
    for (const event of ['play', 'pause', 'ended', 'emptied']) listen(media, event);
    for (const event of ['visibilitychange', 'fullscreenchange']) listen(doc, event);
    for (const event of ['focus', 'blur', 'pagehide', 'pageshow']) listen(win, event);
    record('observe');

    function snapshot({app = '', release = ''} = {}) {
      const ua = String(nav.userAgent || '');
      const chrome = /(?:Chrome|CriOS)\/(\d+(?:\.\d+){0,3})/.exec(ua)?.[1];
      const android = /Android\s+(\d+(?:\.\d+){0,3})/.exec(ua)?.[1];
      return {
        schema: 1,
        app: apps.includes(app) ? app : 'unknown',
        release: version(release),
        environment: {
          chrome: version(chrome),
          android: version(android),
          displayMode: safeCall(() => win.matchMedia('(display-mode: standalone)').matches, false) ? 'standalone' : 'browser',
          // A web page cannot reliably distinguish a normal Chrome tab from a custom tab.
          tabContext: 'unknown'
        },
        nativeExitReason: 'unavailable',
        state: state(),
        lastExit: lastExit ? {...lastExit} : null,
        events: events.map(event => ({...event}))
      };
    }
    return {
      snapshot,
      report: options => JSON.stringify(snapshot(options), null, 2),
      markIntent(intent) { if (intents.includes(intent)) record(intent); },
      markOutcome(outcome) { if (outcomes.includes(outcome)) record(outcome); },
      dispose() { if (disposed) return; disposed = true; listeners.forEach(remove => remove()); }
    };
  }
  global.JarvisPiPDiagnostics = Object.freeze({observe});
})(typeof globalThis !== 'undefined' ? globalThis : this);
