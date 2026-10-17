import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { legacySourceURL, legacySourcePath, appPath, readAppSource } from "./helpers/media-root.mjs";
import { scriptRunsBefore } from "./helpers/shell-assets.mjs";

const MOTION_BUNDLE_BLOB = "01cb4830d63b1e63b270eeaf2d6752946edc8242";

let logicModule;
try {
  logicModule = await import(legacySourceURL("src/interaction-logic.js").href);
} catch (error) {
  logicModule = process.env.MEDIA_APP_ROOT
    ? new Error(`Refusing to fall back to the repo-root copy for src/interaction-logic.js. Jarvis ships the motion compatibility bundle without src modules. ${error.message}`)
    : error;
}
const logic = (name) => (...args) => {
  if (logicModule instanceof Error) throw logicModule;
  return logicModule[name](...args);
};
const dragProgress = logic("dragProgress");
const movedPastTapSlop = logic("movedPastTapSlop");
const navigationDirection = logic("navigationDirection");
const shouldDismiss = logic("shouldDismiss");

const shell = await readAppSource("index.html");
const appSource = await readAppSource("assets/js/app.js");
const html = `${shell}\n${appSource}`;
const css = await readAppSource("assets/css/obsidian.css");
const bundle = await readAppSource("assets/js/astra-motion.js");
let motionSourceResult;
try {
  motionSourceResult = await readFile(legacySourcePath("src/astra-motion.js"), "utf8");
} catch (error) {
  motionSourceResult = error;
}
const motionSource = () => {
  if (motionSourceResult instanceof Error) throw motionSourceResult;
  return motionSourceResult;
};
test("gesture thresholds distinguish a tap, a cancelled drag and a committed dismissal", () => {
  assert.equal(movedPastTapSlop(20, 20, 25, 24), false);
  assert.equal(movedPastTapSlop(20, 20, 32, 20), true);
  assert.equal(shouldDismiss({ distance: 44, velocity: 120, size: 400 }), false);
  assert.equal(shouldDismiss({ distance: 100, velocity: 120, size: 400 }), true);
  assert.equal(shouldDismiss({ distance: 24, velocity: 900, size: 400 }), true);
  assert.equal(dragProgress(900, 400), 1);
});

test("custom press physics owns touch and pen, not mouse clicks", () => {
  assert.match(motionSource(), /event\.pointerType === "mouse"/);
  assert.match(motionSource(), /document\.addEventListener\("pointerdown"/);
  assert.match(motionSource(), /document\.addEventListener\("pointercancel"/);
});

test("navigation direction follows the dock and accepts an explicit back route", () => {
  assert.equal(navigationDirection("home", "library"), "forward");
  assert.equal(navigationDirection("settings", "search"), "back");
  assert.equal(navigationDirection("settings", "settings", "back"), "back");
});

test("the shipped motion bundle matches the qualified compatibility build", async () => {
  if (!process.env.MEDIA_APP_ROOT) {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(pkg.dependencies.gsap, "3.15.0");
    assert.equal(pkg.devDependencies.esbuild, "0.28.2");
  }
  const bytes = await readFile(appPath("assets/js/astra-motion.js"));
  const blob = createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
  assert.equal(blob, MOTION_BUNDLE_BLOB, "Jarvis and the root copy ship the same motion bytes");
  assert.match(bundle, /AstraMotion/);
  assert.equal(scriptRunsBefore(shell, "assets/js/astra-motion.js", "assets/js/app.js"), true, "the shipped bundle loads before app wiring");
  assert.equal(/<script[^>]+src="https?:/.test(html), false, "motion never loads from a CDN");
  assert.equal(bundle.includes("player.session"), false, "the motion layer has no playback-engine ownership");
});

test("navigation, dock and title detail continuity are all wired", () => {
  assert.match(html, /const pageScroll=new Map\(\)/);
  assert.match(html, /Motion\.navigate\(\{from:fromPage,to:page,direction,update\}\)/);
  assert.match(html, /Motion\.syncDock\(\$\('#mobileNav'\),page\)/);
  assert.match(html, /Motion\.sharedOpen\(\{source:opener,targetSelector:'\.dossier-poster'/);
  assert.match(css, /::view-transition-group\(astra-art\)/);
});

test("site-wide content choreography is shared, viewport-aware and bounded", () => {
  assert.match(html, /Motion\.refresh\(root\)/);
  assert.match(bundle, /IntersectionObserver/);
  assert.match(bundle, /\.search-provider-result/);
  assert.match(bundle, /\.video-row/);
  assert.match(bundle, /\.stream-item/);
  assert.match(motionSource(), /const budget = lean \? 8 : 14/);
  assert.match(motionSource(), /const deferred = elements\.slice\(budget\)/);
  assert.match(motionSource(), /deferred\.forEach\(finishReveal\)/);
  assert.match(css, /GSAP also owns content arrival/);
});

test("mobile motion avoids offscreen GPU layers and costly document snapshots", () => {
  const refreshSource = motionSource().slice(motionSource().indexOf("function refresh("), motionSource().indexOf("function handleReducedMotionChange"));
  assert.equal(refreshSource.includes("opacity: 0"), false, "offscreen elements are observed without layer promotion");
  assert.match(motionSource(), /navigator\.deviceMemory/);
  assert.match(motionSource(), /navigator\.hardwareConcurrency/);
  assert.match(motionSource(), /!constrainedMotion\(\).*document\.startViewTransition/);
  assert.match(motionSource(), /reduced\(\) \|\| constrainedMotion\(\)/);
  assert.match(css, /\.motion-lean \.media-image \{ transform: none; transition: opacity 220ms/);
  assert.match(css, /@media \(max-width: 419px\)[\s\S]*\.episode-nav-sticky \{[\s\S]*?backdrop-filter: none;/);
});

test("direct interaction motion never exceeds the 360ms release budget", () => {
  const seconds = [...motionSource().matchAll(/duration:\s*(?:[^\n]*?\?\s*)?(0?\.\d+)/g)].map((match) => Number(match[1]));
  assert.ok(seconds.length >= 9, "the runtime duration set is covered");
  assert.ok(Math.max(...seconds) <= 0.36, `runtime motion reached ${Math.max(...seconds)}s`);
  assert.match(css, /::view-transition-group\(astra-art\) \{[\s\S]*?animation-duration: 340ms;/);
  assert.match(css, /\.seek-feedback\.show \{ animation: player-seek-pop 360ms/);
});

test("View Transition callbacks cannot reorder or stall visible state", () => {
  const open = motionSource().slice(motionSource().indexOf("function sharedOpen"), motionSource().indexOf("function sharedClose"));
  const close = motionSource().slice(motionSource().indexOf("function sharedClose"), motionSource().indexOf("function navigate"));
  const navigation = motionSource().slice(motionSource().indexOf("function navigate"), motionSource().indexOf("function syncDock"));
  assert.match(open, /fallback = setTimeout\(commit, 100\)/);
  assert.match(open, /Promise\.race/);
  assert.match(close, /fallback = setTimeout\(commit, 100\)/);
  assert.equal(navigation.includes("document.startViewTransition"), false, "routes never wait on a snapshot callback");
  assert.match(navigation, /commit\(\);/);
  assert.match(navigation, /duration: lean \? 0\.22 : 0\.28/);
  assert.match(css, /::view-transition \{ pointer-events: none; \}/, "a visual snapshot cannot swallow the next action");
});

test("every mobile overlay can be dismissed physically without touching Player V3", () => {
  assert.match(html, /Motion\.mountSurface\(\{root,key:'sources'/);
  assert.match(html, /detail\?'detail':'utility'/);
  assert.match(html, /Motion\.mountTrackSheet\(menu,\(\)=>clearTrackMenu\(menu\)\)/);
  assert.match(css, /\.motion-surface-edge,/);
  assert.match(css, /\.motion-drag-grip \{/);
  assert.equal(bundle.includes("player.session"), false, "the motion layer has no playback-engine ownership");
});

test("dismissed detail and source surfaces return keyboard focus", () => {
  assert.match(appSource, /function focusBack\(target\)/);
  assert.match(appSource, /modalReturnFocus=opener instanceof HTMLElement\?opener:rememberFocus\(\)/);
  assert.match(appSource, /function finishModalClose\(\).*focusBack\(target\)/);
  assert.match(appSource, /function finishStreamClose\(\).*focusBack\(target\)/);
  assert.match(appSource, /loadStreams\(x\.dataset\.getStreams,x\)/);
  assert.match(appSource, /const fallback=setTimeout\(done,180\)/, "a delayed View Transition cannot hold the modal open");
});

test("reduced motion removes autonomous choreography and gesture zones", () => {
  const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\.motion-page-edge/);
  assert.match(reduced, /display: none !important/);
  assert.match(reduced, /animation-duration: 1ms !important/);
  assert.match(html, /Motion\.reduced|prefers-reduced-motion/);
});
