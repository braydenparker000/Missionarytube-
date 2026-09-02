import { readFile } from "node:fs/promises";
import vm from "node:vm";

const MODULES = ["settings", "streams", "adapters", "engine", "episodes", "subtitles"];

/**
 * Evaluate the shipped playback modules in one isolated context, in the same
 * order index.html loads them, so the tests exercise the exact files the
 * browser runs.
 */
export async function loadPlayback() {
  const context = vm.createContext({
    setTimeout,
    clearTimeout,
    console,
    URL,
    Blob,
    Promise,
    fetch: undefined
  });
  for (const name of MODULES) {
    const source = await readFile(new URL(`../../assets/js/playback/${name}.js`, import.meta.url), "utf8");
    vm.runInContext(source, context, { filename: `assets/js/playback/${name}.js` });
  }
  return context.AstraPlayback;
}

/**
 * Copy an array out of the module's vm realm. Arrays created inside the
 * context have a different Array prototype, which `deepStrictEqual` rejects.
 */
export function plain(list) {
  return Array.from(list ?? []);
}

/** A deterministic clock: nothing runs until the test advances it. */
export function createClock(start = 0) {
  let time = start;
  let nextHandle = 1;
  const timers = new Map();
  return {
    now: () => time,
    get pending() {
      return timers.size;
    },
    setTimeout(fn, ms) {
      const handle = nextHandle++;
      timers.set(handle, { fn, due: time + (Number(ms) || 0) });
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    advance(ms) {
      const target = time + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.due <= target)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!due) break;
        timers.delete(due[0]);
        time = due[1].due;
        due[1].fn();
      }
      time = target;
    }
  };
}

/** A media element double that records what the adapters do to it. */
export function createMediaElement() {
  const listeners = new Map();
  const element = {
    src: "",
    attributes: new Map([["src", ""]]),
    children: [],
    textTracks: [],
    played: 0,
    paused: 0,
    loaded: 0,
    error: null,
    ownerDocument: {
      createElement(tag) {
        return { tag, parentNode: null, remove() {} };
      }
    },
    addEventListener(type, handler, options) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ handler, options });
    },
    removeEventListener(type, handler) {
      const list = listeners.get(type);
      if (!list) return;
      const at = list.findIndex((entry) => entry.handler === handler);
      if (at !== -1) list.splice(at, 1);
    },
    removeAttribute(name) {
      element.attributes.delete(name);
    },
    play() {
      element.played += 1;
      return Promise.resolve();
    },
    pause() {
      element.paused += 1;
    },
    load() {
      element.loaded += 1;
    },
    appendChild(child) {
      child.parentNode = element;
      element.children.push(child);
      return child;
    },
    removeChild(child) {
      const at = element.children.indexOf(child);
      if (at !== -1) element.children.splice(at, 1);
      child.parentNode = null;
      return child;
    },
    emit(type, detail) {
      (listeners.get(type) || []).slice().forEach((entry) => entry.handler(detail || { type }));
    },
    listenerCount(type) {
      if (type) return (listeners.get(type) || []).length;
      return [...listeners.values()].reduce((total, list) => total + list.length, 0);
    }
  };
  return element;
}

/** An hls.js double covering the surface the adapter uses. */
export function createHlsDouble({ supported = true } = {}) {
  const created = [];
  function Hls(config) {
    const instance = {
      config,
      handlers: new Map(),
      source: null,
      media: null,
      destroyed: 0,
      offCalls: 0,
      audioTracks: [
        { name: "English", lang: "en" },
        { name: "Japanese", lang: "ja" }
      ],
      audioTrack: 0,
      levels: [
        { height: 360, bitrate: 800000 },
        { height: 720, bitrate: 2200000 }
      ],
      currentLevel: -1,
      on(event, handler) {
        if (!this.handlers.has(event)) this.handlers.set(event, []);
        this.handlers.get(event).push(handler);
      },
      off() {
        this.offCalls += 1;
        this.handlers.clear();
      },
      loadSource(url) {
        this.source = url;
      },
      attachMedia(media) {
        this.media = media;
      },
      destroy() {
        this.destroyed += 1;
      },
      emit(event, data) {
        (this.handlers.get(event) || []).slice().forEach((handler) => handler(event, data));
      }
    };
    created.push(instance);
    return instance;
  }
  Hls.isSupported = () => supported;
  Hls.Events = { ERROR: "hlsError", MANIFEST_PARSED: "manifestParsed", LEVEL_SWITCHED: "levelSwitched" };
  Hls.created = created;
  return Hls;
}

/**
 * A dash.js double covering the surface the adapter uses.
 *
 * `api` selects which generation of the quality API the double exposes.
 * dash.js renamed it between major versions and Astra's pin moves, so the
 * adapter feature-detects; this is how both branches get exercised.
 */
export function createDashDouble({ api = "v5" } = {}) {
  const created = [];
  const representations = [
    { id: "r0", index: 0, height: 360, bandwidth: 800000, bitrate: 800000, qualityIndex: 0 },
    { id: "r1", index: 1, height: 720, bandwidth: 2200000, bitrate: 2200000, qualityIndex: 1 },
    { id: "r2", index: 2, height: 1080, bandwidth: 4400000, bitrate: 4400000, qualityIndex: 2 }
  ];
  return {
    created,
    representations,
    MediaPlayer() {
      return {
        create() {
          const quality = api === "v5"
            ? {
                getRepresentationsByType: () => representations,
                setRepresentationForTypeById(type, id, force) {
                  this.switched = { type, id, force };
                  this.pinned = representations.findIndex((entry) => entry.id === id);
                },
                getCurrentRepresentationForType() {
                  return this.pinned == null ? null : representations[this.pinned];
                }
              }
            : {
                getBitrateInfoListFor: () => representations,
                setQualityFor(type, index, force) {
                  this.switched = { type, index, force };
                  this.pinned = index;
                },
                getQualityFor() {
                  return this.pinned == null ? -1 : this.pinned;
                }
              };
          const player = {
            ...quality,
            settings: { streaming: { abr: { autoSwitchBitrate: { video: true } } } },
            getSettings() {
              return this.settings;
            },
            updateSettings(patch) {
              const video = patch?.streaming?.abr?.autoSwitchBitrate?.video;
              if (video !== undefined) this.settings.streaming.abr.autoSwitchBitrate.video = video;
            },
            handlers: new Map(),
            initialized: null,
            resets: 0,
            destroys: 0,
            tracks: [
              { lang: "en", index: 0, labels: [{ text: "English" }] },
              { lang: "de", index: 1, labels: [{ text: "German" }] }
            ],
            current: null,
            on(event, handler) {
              if (!this.handlers.has(event)) this.handlers.set(event, []);
              this.handlers.get(event).push(handler);
            },
            off(event, handler) {
              const list = this.handlers.get(event) || [];
              const at = list.indexOf(handler);
              if (at !== -1) list.splice(at, 1);
            },
            initialize(media, url, autoplay) {
              this.initialized = { media, url, autoplay };
            },
            getTracksFor() {
              return this.tracks;
            },
            getCurrentTrackFor() {
              return this.current;
            },
            setCurrentTrack(track) {
              this.current = track;
            },
            reset() {
              this.resets += 1;
            },
            destroy() {
              this.destroys += 1;
            },
            emit(event, data) {
              (this.handlers.get(event) || []).slice().forEach((handler) => handler(data));
            }
          };
          created.push(player);
          return player;
        }
      };
    }
  };
}
