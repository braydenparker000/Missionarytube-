import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppSource } from "./helpers/media-root.mjs";

const shell = await readAppSource("index.html");
const appearanceSource = await readAppSource("assets/js/appearance.js");
const bootstrapSource = await readAppSource("assets/js/bootstrap.js");
const cinema = await readAppSource("assets/css/cinema.css");

function luminance(hex) {
  const value = hex.replace("#", "");
  const parts = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255);
  const linear = parts.map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function isDark(color) {
  const hex = color.match(/#([0-9a-fA-F]{6})/)?.[1];
  assert.ok(hex, `${color} must name a concrete color`);
  return luminance(hex) < 0.08;
}

function scriptTags(head) {
  return [...head.matchAll(/<script\b([^>]*)>/g)].map((match) => {
    const tag = match[1];
    const src = tag.match(/\bsrc="([^"]+)"/)?.[1] || "";
    const deferred = /\sdefer\b/.test(tag) || /\sasync\b/.test(tag) || /\btype\s*=\s*["']module["']/.test(tag);
    return { src, blocksParser: Boolean(src) && !deferred };
  });
}

/**
 * Stylesheets and critical CSS apply while scripts are still in flight.
 * Parser-blocking head scripts hold first paint; deferred scripts do not.
 * A script tag's presence is not treated as evidence that it has run.
 */
function firstPaint(stored) {
  const head = shell.slice(shell.indexOf("<head>"), shell.indexOf("</head>"));
  const scripts = scriptTags(head);
  const inline = shell.match(/<style>([\s\S]*?)<\/style>/)?.[1] || "";
  const criticalBackground = inline.match(/html\{[^}]*background:([^;}]+)/)?.[1]?.trim() || "";
  const rootTokens = cinema.match(/:root\s*\{([\s\S]*?)\}/)?.[1] || "";
  const stylesheetAccent = rootTokens.match(/--accent:\s*([^;]+)/)?.[1]?.trim() || "";
  const floor = rootTokens.match(/--cinema-floor:\s*([^;]+)/)?.[1]?.trim() || "";
  const dataset = {};
  const classes = new Set();
  const documentElement = {
    dataset,
    classList: { add: (name) => classes.add(name) }
  };
  const executed = [];
  for (const script of scripts) {
    if (!script.blocksParser) continue;
    executed.push(script.src);
    if (script.src.includes("bootstrap.js")) {
      const context = vm.createContext({ document: { documentElement } });
      vm.runInContext(bootstrapSource, context);
    }
    if (script.src.includes("appearance.js")) {
      const context = vm.createContext({
        document: { documentElement },
        localStorage: { getItem: () => stored, setItem() {} },
        CustomEvent: class {
          constructor(type, init) {
            this.type = type;
            this.detail = init?.detail;
          }
        },
        dispatchEvent() {}
      });
      vm.runInContext(appearanceSource, context);
    }
  }
  return {
    dataset,
    jsClass: classes.has("js"),
    executed,
    pending: scripts.filter((script) => !script.blocksParser).map((script) => script.src),
    appearanceBlocksParser: scripts.some((script) => script.src.includes("appearance.js") && script.blocksParser),
    criticalBackground,
    stylesheetAccent,
    floor
  };
}

test("initial theme renders while appearance and bootstrap are still loading", () => {
  const stored = JSON.stringify({ accent: "violet", motion: "off", surface: "charcoal" });
  const paint = firstPaint(stored);
  assert.equal(paint.executed.some((src) => src.includes("defer")), false);
  assert.ok(isDark(paint.floor), "the render-blocking stylesheet paints the dark floor without waiting for scripts");
  assert.ok(isDark(paint.criticalBackground), "critical CSS still has a dark fallback if the token is not ready");
  assert.equal(paint.stylesheetAccent, "#b4d1ff", "the default accent is the ice token, available before any script");
  assert.match(shell, /name="color-scheme" content="dark"/);

  if (paint.appearanceBlocksParser) {
    assert.equal(paint.dataset.accent, "violet", "a parser-blocking appearance script applies the stored accent before first paint");
    assert.equal(paint.dataset.motion, "off");
    assert.equal(paint.dataset.surface, "charcoal");
    assert.equal(paint.jsClass, true, "parser-blocking bootstrap marks the document before first paint");
    assert.deepEqual(paint.pending, []);
    return;
  }

  assert.equal(paint.dataset.accent, undefined, "a deferred appearance script has not applied the stored theme at first paint");
  assert.equal(paint.dataset.motion, undefined);
  assert.equal(paint.jsClass, false, "a deferred bootstrap script has not marked the document at first paint");
  assert.ok(paint.pending.some((src) => src.includes("appearance.js")));
  assert.ok(paint.pending.some((src) => src.includes("bootstrap.js")));
  assert.equal(paint.executed.length, 0, "throttled deferred scripts are not treated as having run");
});
