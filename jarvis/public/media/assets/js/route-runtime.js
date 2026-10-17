(() => {
  "use strict";

  function createRouteRuntime() {
    const records = new Map();
    const generations = new Map();

    function release(name) {
      const record = records.get(name);
      generations.set(name, (generations.get(name) || 0) + 1);
      if (!record) return false;
      records.delete(name);
      if (!record.controller.signal.aborted) record.controller.abort();
      [...record.disposers].reverse().forEach((dispose) => {
        try { dispose(); } catch (error) { console.error("Astra route cleanup failed", error); }
      });
      record.disposers.clear();
      return true;
    }

    function begin(name) {
      release(name);
      const generation = generations.get(name) || 0;
      const controller = new AbortController();
      const record = { controller, disposers: new Set(), generation };
      records.set(name, record);
      const current = () => records.get(name) === record && !controller.signal.aborted;
      return Object.freeze({
        name,
        generation,
        signal: controller.signal,
        current,
        onDispose(dispose) {
          if (typeof dispose !== "function") return dispose;
          if (!current()) dispose();
          else record.disposers.add(dispose);
          return dispose;
        },
        release() {
          if (records.get(name) !== record) return false;
          return release(name);
        }
      });
    }

    return Object.freeze({
      begin,
      release,
      current(name) {
        const record = records.get(name);
        return Boolean(record && !record.controller.signal.aborted);
      }
    });
  }

  globalThis.AstraRoutes = Object.freeze({ createRouteRuntime });
})();
