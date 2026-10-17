import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

// These 29 names fail on the pinned tree before any assertion because that
// tree has no src/compatibility-player.js, src/interaction-logic.js, or
// src/astra-motion.js. They stay exact: the pinned run skips them, and the
// source-only run selects them wherever those modules exist.
export const SOURCE_ONLY_TESTS = [
  "real MKV AVC/AAC is repackaged to fragmented MP4 with video bytes intact",
  "HEVC repair declares hvc1 exactly as the pinned MP4 muxer writes it",
  "HEVC open-GOP seeking drops unavailable leading pictures and preserves retained video and audio bytes",
  "seeking starts at a preceding keyframe and unsupported video is explicit",
  "surround audio is downmixed to bounded stereo samples",
  "audio crossing a video keyframe is trimmed before encoding to avoid negative timestamps",
  "an unsupported default audio track falls back to usable audio in the same file",
  "replacing an in-flight startup reports the old read as cancelled, not a new playback failure",
  "real 40-second MKV VP8/Vorbis uses WebM when MP4 is unavailable, preserving both tracks",
  "audio conversion selects AAC when MP4 cannot accept Opus",
  "a WebM repair seek retains a preceding keyframe beyond the initial read-ahead window",
  "copied AAC audio crossing a seek keyframe keeps its timing and no longer fails the muxer",
  "compatibility fetch keeps addon headers on their origin and follows demuxer byte ranges",
  "compatibility HLS children on another origin never receive addon credentials",
  "compatibility startup distinguishes blocked access and connection failures",
  "audio repair retries a transient request and transfers the real prepared input without rereading",
  "audio repair bounds persistent fetch failures to one shared retry",
  "audio repair bounds persistent body failures to one shared retry",
  "cancelling repair during its retry delay stops it without another request",
  "repair cancellation promptly rejects a pending metadata fetch",
  "prepared repair is disposed when abandoned or its adapter is destroyed before attach",
  "aborting an unconsumed prepared repair invalidates it; abort after transfer leaves ownership with the adapter",
  "gesture thresholds distinguish a tap, a cancelled drag and a committed dismissal",
  "custom press physics owns touch and pen, not mouse clicks",
  "navigation direction follows the dock and accepts an explicit back route",
  "site-wide content choreography is shared, viewport-aware and bounded",
  "mobile motion avoids offscreen GPU layers and costly document snapshots",
  "direct interaction motion never exceeds the 360ms release budget",
  "View Transition callbacks cannot reorder or stall visible state"
];

export const SOURCE_ONLY_FILES = [
  "tests/compatibility-player.test.mjs",
  "tests/interaction-motion.test.mjs"
];

const SOURCE_MODULES = [
  "src/compatibility-player.js",
  "src/interaction-logic.js",
  "src/astra-motion.js"
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sourceOnlyPattern(names = SOURCE_ONLY_TESTS) {
  return `^(?:${names.map(escapeRegExp).join("|")})$`;
}

export function sourceModulesPresent(root) {
  return SOURCE_MODULES.every((file) => {
    try {
      return statSync(resolve(root, file)).isFile();
    } catch {
      return false;
    }
  });
}

// One fenced `qualification` block. Each item is `todo<TAB>name<TAB>file`.
// A missing fence, a second fence, or a bad line is malformed, which is not
// an empty list.
export function parsePending(markdown) {
  const fences = [...String(markdown).matchAll(/```qualification\n([\s\S]*?)```/g)];
  if (fences.length !== 1) return { malformed: true, items: [] };
  const items = [];
  for (const line of fences[0][1].split("\n")) {
    if (line.trim() === "") continue;
    const parts = line.split("\t");
    if (parts.length !== 3 || parts.some((part) => part.trim() === "")) return { malformed: true, items: [] };
    const [kind, name, file] = parts;
    if (kind !== "todo") return { malformed: true, items: [] };
    items.push({ kind, name, file });
  }
  return { malformed: false, items };
}

function todoReasonEmpty(options) {
  return /\btodo\s*:\s*(?:""|''|true)(?![A-Za-z0-9_])/.test(options);
}

// Counts test.todo and test(..., { todo }) entries, including an empty
// reason. An empty todo is still a todo.
export function scanSource(source, file = "<memory>") {
  const text = String(source);
  const found = [];
  const seen = new Set();
  const add = (name, empty) => {
    if (seen.has(name)) return;
    seen.add(name);
    found.push({ file, name, empty: Boolean(empty) });
  };
  for (const match of text.matchAll(/test\.todo\(\s*(["'])((?:\\.|(?!\1).)*)\1/g)) add(match[2], true);
  for (const match of text.matchAll(/test\(\s*(["'])((?:\\.|(?!\1).)*)\1\s*,\s*\{([\s\S]*?)\}\s*,/g)) {
    if (/\btodo\s*:/.test(match[3])) add(match[2], todoReasonEmpty(match[3]));
  }
  return found;
}

export function scanTodos(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && (entry.name.endsWith(".mjs") || entry.name.endsWith(".js"))) {
        const relative = path.slice(dir.length + 1).replaceAll("\\", "/");
        const file = relative.startsWith("tests/") ? relative : `tests/${relative}`;
        found.push(...scanSource(readFileSync(path, "utf8"), file));
      }
    }
  };
  walk(dir);
  return found;
}

export function verdict({ testsPass = false, pending = null, todos = [] } = {}) {
  const reasons = [];
  if (!testsPass) reasons.push("tests failed");
  if (!pending || pending.malformed) reasons.push("pending list missing or malformed");
  else if (pending.items.length > 0) reasons.push("pending items remain");
  if (todos.length > 0) reasons.push("todos remain");
  if (pending && !pending.malformed) {
    const pendingKeys = new Set(pending.items.map((item) => `${item.file}\0${item.name}`));
    const todoKeys = new Set(todos.map((item) => `${item.file}\0${item.name}`));
    for (const key of todoKeys) {
      if (!pendingKeys.has(key)) reasons.push(`todo not listed: ${key.split("\0")[1]}`);
    }
    for (const key of pendingKeys) {
      if (!todoKeys.has(key)) reasons.push(`listed item has no todo: ${key.split("\0")[1]}`);
    }
  }
  const ready = reasons.length === 0;
  return {
    ready,
    status: ready ? "READY" : "NOT READY",
    reasons,
    todoCount: todos.length,
    pendingCount: pending && !pending.malformed ? pending.items.length : null
  };
}
