import { readFile } from "node:fs/promises";
import vm from "node:vm";

const MODULE_URL = new URL("../../assets/js/progress-store.js", import.meta.url);

/**
 * Evaluate the shipped classic script in an isolated context, so the tests
 * exercise the exact file the browser loads.
 */
export async function loadProgressModule() {
  const source = await readFile(MODULE_URL, "utf8");
  const context = vm.createContext({ setTimeout, clearTimeout, console });
  vm.runInContext(source, context, { filename: "assets/js/progress-store.js" });
  return context.AstraProgress;
}

/** Minimal localStorage double with an optional character quota. */
export function createStorage(options = {}) {
  const { quota = Infinity, fail = null } = options;
  const map = new Map();
  return {
    map,
    writes: 0,
    rejected: 0,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (fail) {
        this.rejected += 1;
        throw fail();
      }
      if (value.length > quota) {
        this.rejected += 1;
        throw quotaError();
      }
      this.writes += 1;
      map.set(key, value);
    }
  };
}

export function quotaError() {
  const error = new Error("The quota has been exceeded.");
  error.name = "QuotaExceededError";
  error.code = 22;
  return error;
}

export function securityError() {
  const error = new Error("Storage is disabled for this origin.");
  error.name = "SecurityError";
  return error;
}

/** Manual clock and timer queue so throttling can be asserted deterministically. */
export function createClock(start = 1_700_000_000_000) {
  let time = start;
  let nextHandle = 1;
  const timers = new Map();
  return {
    now: () => time,
    advance(ms) {
      time += ms;
      for (const [handle, timer] of [...timers].sort((a, b) => a[1].due - b[1].due)) {
        if (timer.due <= time) {
          timers.delete(handle);
          timer.fn();
        }
      }
    },
    schedule(fn, ms) {
      const handle = nextHandle++;
      timers.set(handle, { fn, due: time + ms });
      return handle;
    },
    cancel(handle) {
      timers.delete(handle);
    },
    get pending() {
      return timers.size;
    }
  };
}

/**
 * A representative fat series metadata object, the shape an add-on returns and
 * that the old progress records duplicated into every episode entry.
 */
export function seriesMeta(episodeCount = 200) {
  return {
    id: "tt0903747",
    type: "series",
    name: "Breaking Bad",
    poster: "https://images.example.test/poster.jpg",
    background: "https://images.example.test/background.jpg",
    logo: "https://images.example.test/logo.png",
    releaseInfo: "2008-2013",
    imdbRating: "9.5",
    genres: ["Drama", "Crime", "Thriller"],
    cast: Array.from({ length: 20 }, (_, i) => `Cast Member Number ${i}`),
    description: "A high school chemistry teacher turns to crime. ".repeat(20),
    _addonName: "Cinemeta",
    _addonUrl: "https://v3-cinemeta.strem.io/manifest.json",
    videos: Array.from({ length: episodeCount }, (_, i) => ({
      id: `tt0903747:${Math.floor(i / 13) + 1}:${(i % 13) + 1}`,
      season: Math.floor(i / 13) + 1,
      episode: (i % 13) + 1,
      title: `Episode title number ${i + 1}`,
      released: "2008-01-20T00:00:00.000Z",
      overview: `Episode ${i + 1} synopsis. `.repeat(10),
      thumbnail: `https://images.example.test/thumb/${i + 1}.jpg`
    }))
  };
}

/** The record shape this change replaces, used for a size comparison. */
export function legacyRecords(meta, episodeCount) {
  const records = {};
  for (let i = 0; i < episodeCount; i += 1) {
    const video = meta.videos[i];
    const key = `${meta.type}:${meta.id}|${video.id}`;
    records[key] = {
      key,
      mediaKey: `${meta.type}:${meta.id}`,
      time: 300 + i,
      duration: 2700,
      completed: false,
      updated: 1_700_000_000_000 + i,
      videoId: video.id,
      video,
      meta
    };
  }
  return records;
}
