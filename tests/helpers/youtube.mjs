import { readFile } from "node:fs/promises";
import vm from "node:vm";

const MODULES = ["config", "instances", "api", "playback"];

/**
 * Evaluate the shipped YouTube modules in one isolated context, in the same
 * order index.html loads them, so the tests exercise the exact files the
 * browser runs. `AstraPlayback.streams` is loaded too, because the playback
 * planner asks it for the browser's media capabilities.
 */
export async function loadYouTube() {
  const context = vm.createContext({
    setTimeout,
    clearTimeout,
    console,
    URL,
    Map,
    Promise,
    AbortController,
    Event,
    EventTarget
  });
  const streams = await readFile(new URL("../../assets/js/playback/streams.js", import.meta.url), "utf8");
  vm.runInContext(streams, context, { filename: "assets/js/playback/streams.js" });
  for (const name of MODULES) {
    const source = await readFile(new URL(`../../assets/js/youtube/${name}.js`, import.meta.url), "utf8");
    vm.runInContext(source, context, { filename: `assets/js/youtube/${name}.js` });
  }
  return context.AstraYouTube;
}

/**
 * Copy an array out of the module's vm realm. Arrays created inside the
 * context have a different Array prototype, which `deepStrictEqual` rejects.
 */
export function plain(list) {
  return Array.from(list ?? []);
}

/** A manual clock: nothing expires or recovers until the test says so. */
export function createClock(start = 1_700_000_000_000) {
  let time = start;
  return {
    get start() {
      return start;
    },
    now: () => time,
    advance(ms) {
      time += ms;
      return time;
    },
    set(at) {
      time = at;
      return time;
    }
  };
}

/**
 * A `fetch` double that answers per instance host.
 *
 * `routes` maps an instance origin to either a function (called with the URL
 * and returning a response description) or a fixed description. Every request
 * is recorded, which is how the failover, cooldown and de-duplication tests
 * assert on what actually went out.
 *
 * `latency` gives an origin a response time in milliseconds. One synthetic
 * clock cannot represent two durations overlapping, so when latency is in play
 * the bodies are handed over one at a time: a call sets the clock to its own
 * reading, delivers its body, and only then releases the next one. Requests
 * are still all issued together - it is the measurements that are serialised,
 * which is what makes a concurrent sweep assertable at all.
 */
export function createFetch(routes, options = {}) {
  const calls = [];
  const latency = options.latency || {};
  const clock = options.clock;
  let gate = Promise.resolve();

  return Object.assign(
    async function fetchDouble(url, init = {}) {
      const origin = new URL(url).origin;
      calls.push({ url, origin, init });
      const route = routes[origin];
      if (!route) throw new TypeError("Failed to fetch");

      const described = typeof route === "function" ? await route(url, init, calls.length) : route;
      if (described instanceof Error) throw described;
      if (described.abort) {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        throw error;
      }
      if (described.hang) {
        // Never settles on its own: the request's own timeout has to fire.
        return new Promise((resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const error = new Error("The operation was aborted.");
            error.name = "AbortError";
            reject(error);
          });
        });
      }
      const status = described.status ?? 200;
      const body = described.text ?? JSON.stringify(described.body ?? {});
      return {
        ok: status >= 200 && status < 300,
        status,
        text: () => {
          if (!clock || latency[origin] == null) return Promise.resolve(body);
          const mine = gate.then(() => {
            clock.set(clock.start + latency[origin]);
            return body;
          });
          // Hold the next body until this one's latency has been read.
          gate = mine.then(async () => {
            for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
          });
          return mine;
        }
      };
    },
    { calls }
  );
}

/** The manager under test, wired to a double and a manual clock. */
export function createManager(YT, { config = {}, routes = {}, clock = createClock(), latency = {} } = {}) {
  const resolved = YT.config.resolve(config);
  const fetchDouble = createFetch(routes, { clock, latency });
  const manager = YT.instances.createManager({
    config: resolved,
    instances: YT.config.instanceList(resolved),
    fetch: fetchDouble,
    now: clock.now,
    AbortController
  });
  return { manager, config: resolved, fetch: fetchDouble, clock };
}
