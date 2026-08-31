import { readFile } from "node:fs/promises";
import vm from "node:vm";

/**
 * Evaluate a shipped classic script in an isolated context and return the
 * global it attaches, so the tests exercise the exact file the browser loads.
 */
async function loadGlobal(path, name) {
  const source = await readFile(new URL(`../../${path}`, import.meta.url), "utf8");
  const context = vm.createContext({ console, Math, Number, String, Array, Object });
  vm.runInContext(source, context, { filename: path });
  return context[name];
}

export function loadHub() {
  return loadGlobal("assets/js/hub.js", "AstraHub");
}

export function loadAudio() {
  return loadGlobal("assets/js/audio-player.js", "AstraAudio");
}

/** A minimal add-on source in the shape `manifests()` returns. */
export function source(name, catalogs, resources = ["catalog", "meta", "stream"]) {
  return {
    addon: { url: `https://example.test/${name}/manifest.json`, enabled: true },
    manifest: { id: name, name, version: "1.0.0", resources, catalogs }
  };
}

/** A media element double: every field the audio snapshot reads. */
export function media({ currentTime = 0, duration = 0, paused = true, buffered = [] } = {}) {
  return {
    currentTime,
    duration,
    paused,
    buffered: {
      length: buffered.length,
      start: (i) => buffered[i][0],
      end: (i) => buffered[i][1]
    }
  };
}
