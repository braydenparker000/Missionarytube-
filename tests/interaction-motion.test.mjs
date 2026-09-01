import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  dragProgress,
  movedPastTapSlop,
  navigationDirection,
  shouldDismiss
} from "../src/interaction-logic.js";

const html = await readFile("index.html", "utf8");
const css = await readFile("assets/css/obsidian.css", "utf8");
const bundle = await readFile("assets/js/astra-motion.js", "utf8");
const source = await readFile("src/astra-motion.js", "utf8");
const pkg = JSON.parse(await readFile("package.json", "utf8"));

test("gesture thresholds distinguish a tap, a cancelled drag and a committed dismissal", () => {
  assert.equal(movedPastTapSlop(20, 20, 25, 24), false);
  assert.equal(movedPastTapSlop(20, 20, 32, 20), true);
  assert.equal(shouldDismiss({ distance: 44, velocity: 120, size: 400 }), false);
  assert.equal(shouldDismiss({ distance: 100, velocity: 120, size: 400 }), true);
  assert.equal(shouldDismiss({ distance: 24, velocity: 900, size: 400 }), true);
  assert.equal(dragProgress(900, 400), 1);
});

test("navigation direction follows the dock and accepts an explicit back route", () => {
  assert.equal(navigationDirection("home", "library"), "forward");
  assert.equal(navigationDirection("settings", "search"), "back");
  assert.equal(navigationDirection("settings", "settings", "back"), "back");
});

test("the motion runtime is exact, local and loaded before app wiring", () => {
  assert.equal(pkg.dependencies.gsap, "3.15.0");
  assert.equal(pkg.devDependencies.esbuild, "0.28.2");
  const runtime = html.indexOf('<script src="assets/js/astra-motion.js?v=0.18.1"></script>');
  const app = html.indexOf("<script>\n  (()=>{'use strict';");
  assert.ok(runtime > -1 && runtime < app);
  assert.match(bundle, /AstraMotion/);
  assert.equal(/<script[^>]+src="https?:/.test(html), false, "motion never loads from a CDN");
});

test("navigation, dock, hero and detail continuity are all wired", () => {
  assert.match(html, /const pageScroll=new Map\(\)/);
  assert.match(html, /Motion\.navigate\(\{from:fromPage,to:page,direction,update\}\)/);
  assert.match(html, /Motion\.syncDock\(\$\('#mobileNav'\),page\)/);
  assert.match(html, /Motion\.bindHero\(deck,dots\)/);
  assert.match(html, /Motion\.sharedOpen\(\{source:opener,targetSelector:'\.dossier-poster'/);
  assert.match(css, /view-transition-name: astra-page/);
  assert.match(css, /::view-transition-group\(astra-art\)/);
});

test("site-wide content choreography is shared, viewport-aware and bounded", () => {
  assert.match(html, /Motion\.refresh\(root\)/);
  assert.match(bundle, /IntersectionObserver/);
  assert.match(bundle, /\.search-provider-result/);
  assert.match(bundle, /\.video-row/);
  assert.match(bundle, /\.stream-item/);
  assert.match(source, /const budget = lean \? 8 : 14/);
  assert.match(source, /const deferred = elements\.slice\(budget\)/);
  assert.match(source, /deferred\.forEach\(finishReveal\)/);
  assert.match(css, /GSAP also owns content arrival/);
});

test("mobile motion avoids offscreen GPU layers and costly document snapshots", () => {
  const refreshSource = source.slice(source.indexOf("function refresh("), source.indexOf("function handleReducedMotionChange"));
  assert.equal(refreshSource.includes("opacity: 0"), false, "offscreen elements are observed without layer promotion");
  assert.match(source, /navigator\.deviceMemory/);
  assert.match(source, /navigator\.hardwareConcurrency/);
  assert.match(source, /!constrainedMotion\(\).*document\.startViewTransition/);
  assert.match(source, /reduced\(\) \|\| constrainedMotion\(\)/);
});

test("every mobile overlay can be dismissed physically without touching Player V3", () => {
  assert.match(html, /Motion\.mountSurface\(\{root,key:'sources'/);
  assert.match(html, /detail\?'detail':briefing\?'briefing':'utility'/);
  assert.match(html, /Motion\.mountTrackSheet\(menu,\(\)=>clearTrackMenu\(menu\)\)/);
  assert.match(css, /\.motion-surface-edge,/);
  assert.match(css, /\.motion-drag-grip \{/);
  assert.equal(bundle.includes("player.session"), false, "the motion layer has no playback-engine ownership");
});

test("reduced motion removes autonomous choreography and gesture zones", () => {
  const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\.motion-page-edge/);
  assert.match(reduced, /display: none !important/);
  assert.match(reduced, /animation-duration: 1ms !important/);
  assert.match(html, /Motion\.reduced|prefers-reduced-motion/);
});
