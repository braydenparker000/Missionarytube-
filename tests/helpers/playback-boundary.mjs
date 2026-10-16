import vm from "node:vm";
import { extractIndentedFunction } from "./app-extract.mjs";

/**
 * Run the pagehide, hidden-page, pause, and closePlayer paths against a
 * progress double. Jarvis saves through checkpointPlayback; the root copy
 * flushes. Either way the live position is persisted and completion is not invented.
 */
export function loadPlaybackBoundary(source) {
  const records = [];
  let flushes = 0;
  const progress = {
    record(meta, video, detail) {
      records.push({ meta, video, detail: { ...detail } });
    },
    flush() {
      flushes += 1;
    }
  };
  const listeners = { window: {}, document: {} };
  const media = { currentTime: 120.5, duration: 1000, readyState: 2, ended: false, paused: true };
  const player = {
    meta: { id: "movie" },
    video: { id: "episode-1" },
    session: null,
    leaseAbort: null,
    audioMode: false,
    sources: []
  };
  const state = { currentMeta: null };
  const nodes = new Map([
    ["#mediaEl", media],
    ["#countdownCard", { remove() {} }],
    ["#audioRoot", { innerHTML: "" }]
  ]);
  const pauseHandlers = [];
  const context = vm.createContext({
    progress,
    player,
    state,
    $(selector) {
      return nodes.get(selector) || null;
    },
    window: {
      addEventListener(type, fn) {
        listeners.window[type] = fn;
      }
    },
    document: {
      visibilityState: "visible",
      body: { classList: { remove() {} } },
      addEventListener(type, fn) {
        listeners.document[type] = fn;
      }
    },
    clearTimeout() {},
    Motion: { releaseElement() {} },
    teardownAttempt() {},
    closeModal() {},
    showDetail() {},
    renderStreams() {},
    live: () => true,
    el: media,
    scope: {
      disposed: false,
      listen(_el, event, fn) {
        if (event === "pause") pauseHandlers.push(fn);
      }
    }
  });

  const checkpoint = extractIndentedFunction(source, "checkpointPlayback");
  if (checkpoint) vm.runInContext(checkpoint, context);
  const registration = source.match(/window\.addEventListener\('pagehide',[\s\S]*?visibilityState==='hidden'\)[\s\S]*?\}\)/);
  if (!registration) throw new Error("pagehide does not save playback progress");
  vm.runInContext(registration[0], context);

  const checkpointListen = source.indexOf("const checkpoint=()=>{if(live()&&!scope.disposed)checkpointPlayback()};");
  if (checkpointListen >= 0) {
    const seeked = "scope.listen(el,'seeked',checkpoint);";
    const end = source.indexOf(seeked, checkpointListen);
    if (end < 0) throw new Error("pause does not checkpoint playback");
    vm.runInContext(source.slice(checkpointListen, end + seeked.length), context);
  } else {
    const pause = "scope.listen(el,'pause',()=>progress.flush());";
    if (!source.includes(pause)) throw new Error("pause does not save playback progress");
    vm.runInContext(pause, context);
  }

  const closePlayer = extractIndentedFunction(source, "closePlayer");
  if (!closePlayer) throw new Error("closePlayer is missing");
  vm.runInContext(closePlayer, context);

  return {
    records,
    get flushes() {
      return flushes;
    },
    listeners,
    pauseHandlers,
    context,
    media,
    player,
    hasCheckpoint: Boolean(checkpoint),
    hidePage() {
      context.document.visibilityState = "hidden";
      listeners.window.pagehide?.();
    },
    hideVisibility() {
      context.document.visibilityState = "hidden";
      listeners.document.visibilitychange?.();
    },
    pause() {
      pauseHandlers.at(-1)?.();
    },
    close() {
      context.closePlayer(true);
    }
  };
}
