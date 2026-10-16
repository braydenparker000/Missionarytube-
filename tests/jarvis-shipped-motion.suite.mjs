import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mediaAppRoot, readAppSource } from "./helpers/media-root.mjs";

if (!process.env.MEDIA_APP_ROOT) {
  throw new Error("Refusing to read the repo-root media copy. This suite runs only with MEDIA_APP_ROOT set to the pinned Jarvis checkout.");
}
mediaAppRoot();

const motionSource = await readAppSource("assets/js/astra-motion.js");
const css = await readAppSource("assets/css/obsidian.css");
const chrome = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"].find((path) => path && existsSync(path));
if (!chrome) throw new Error("Chrome is required to exercise the shipped Jarvis motion bundle. Set CHROME_PATH.");
const { chromium } = createRequire(import.meta.url)("playwright-core");
const browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
test.after(async () => { await browser.close(); });

function translateX(transform) {
  const match = /matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*(-?\d+(?:\.\d+)?)/.exec(transform || "");
  return match ? Number(match[1]) : 0;
}

async function openPage({ width, height, touch = false, body, clock = false }) {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  // GSAP captures requestAnimationFrame when the bundle evaluates. Install the
  // clock first so a later fast-forward actually releases those tweens.
  if (clock) await page.clock.install();
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`);
  await page.addScriptTag({ content: motionSource });
  await page.evaluate(() => AstraMotion.init());
  return {
    page,
    errors,
    async close() { await page.close(); }
  };
}

test("shipped motion distinguishes a tap, a cancelled drag, and a committed dismissal", async () => {
  const session = await openPage({
    width: 850,
    height: 800,
    body: `<button class="btn" id="press" style="width:80px;height:40px">Go</button>
      <div id="surface" style="position:fixed;inset:0"><div class="backdrop" style="position:absolute;inset:0"><div class="panel" style="position:absolute;inset:40px;background:#222">panel</div></div></div>`
  });
  try {
    const press = await session.page.evaluate(async () => {
      const button = document.querySelector("#press");
      const at = (type, pointerType, x, y) => button.dispatchEvent(new PointerEvent(type, {
        pointerType, clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true, button: 0, pointerId: 1
      }));
      at("pointerdown", "mouse", 20, 20);
      await new Promise((resolve) => setTimeout(resolve, 160));
      const mouse = getComputedStyle(button).transform;
      at("pointerup", "mouse", 20, 20);
      at("pointerdown", "touch", 20, 20);
      await new Promise((resolve) => setTimeout(resolve, 160));
      const touch = getComputedStyle(button).transform;
      at("pointermove", "touch", 25, 24);
      const withinSlop = getComputedStyle(button).transform;
      at("pointermove", "touch", 32, 20);
      await new Promise((resolve) => setTimeout(resolve, 180));
      const pastSlop = getComputedStyle(button).transform;
      return { mouse, touch, withinSlop, pastSlop };
    });
    assert.equal(press.mouse, "none", "mouse clicks do not start press physics");
    assert.ok(translateX(press.touch) !== 0 || press.touch.includes("0.97"), "a touch press scales the control");
    assert.match(press.withinSlop, /0\.97/, "a move inside the tap slop stays a press");
    assert.doesNotMatch(press.pastSlop, /0\.97/, "a move past the tap slop releases the press");

    await session.page.evaluate(() => {
      window.dismissed = 0;
      AstraMotion.mountSurface({
        root: document.querySelector("#surface"),
        key: "detail",
        onDismiss() { window.dismissed += 1; }
      });
    });
    const grip = session.page.locator(".motion-drag-grip");
    const settled = () => session.page.waitForFunction(() => {
      const panel = document.querySelector(".panel");
      const transform = getComputedStyle(panel).transform;
      if (transform === "none") return true;
      const parts = transform.slice(transform.indexOf("(") + 1, -1).split(",").map((part) => Number(part));
      return Math.abs(parts[5] || 0) < 1;
    });
    await settled();
    const drag = async (distance) => {
      const box = await grip.boundingBox();
      assert.ok(box && box.height > 0, "the shipped surface exposes a drag grip");
      const x = box.x + box.width / 2;
      const y = box.y + Math.min(8, box.height / 2);
      await session.page.mouse.move(x, y);
      await session.page.mouse.down();
      await session.page.mouse.move(x, y + distance, { steps: 16 });
      const reading = await session.page.evaluate(() => ({
        dismissed: window.dismissed,
        progress: Number(document.querySelector(".backdrop").style.getPropertyValue("--motion-dismiss"))
      }));
      await session.page.mouse.up();
      return reading;
    };
    const cancelled = await drag(70);
    await settled();
    const afterCancel = await session.page.evaluate(() => window.dismissed);
    assert.equal(cancelled.dismissed, 0);
    assert.equal(afterCancel, 0, "a drag below the dismiss distance snaps back");
    assert.ok(cancelled.progress > 0 && cancelled.progress < 1, `drag progress stays inside the axis (${cancelled.progress})`);

    const committedDrag = await drag(280);
    await session.page.waitForFunction(() => window.dismissed === 1, { timeout: 2000 }).catch(() => {});
    const committed = await session.page.evaluate(() => window.dismissed);
    assert.equal(committed, 1, `a drag past the dismiss distance closes the surface (progress ${committedDrag.progress})`);
    assert.ok(committedDrag.progress > cancelled.progress && committedDrag.progress <= 1);
    assert.deepEqual(session.errors, []);
  } finally { await session.close(); }
});

test("shipped custom press physics owns touch and pen, not mouse clicks", async () => {
  const session = await openPage({
    width: 850,
    height: 800,
    body: `<button class="btn" id="press" style="width:80px;height:40px">Go</button>`
  });
  try {
    const result = await session.page.evaluate(async () => {
      const button = document.querySelector("#press");
      const read = async (pointerType) => {
        button.dispatchEvent(new PointerEvent("pointerdown", {
          pointerType, clientX: 12, clientY: 12, bubbles: true, cancelable: true, isPrimary: true, button: 0, pointerId: 3
        }));
        await new Promise((resolve) => setTimeout(resolve, 150));
        const transform = getComputedStyle(button).transform;
        button.dispatchEvent(new PointerEvent("pointercancel", {
          pointerType, bubbles: true, cancelable: true, isPrimary: true, pointerId: 3
        }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        return transform;
      };
      return { mouse: await read("mouse"), touch: await read("touch"), pen: await read("pen") };
    });
    assert.equal(result.mouse, "none");
    assert.match(result.touch, /0\.97/);
    assert.match(result.pen, /0\.97/);
    assert.deepEqual(session.errors, []);
  } finally { await session.close(); }
});

test("shipped navigation direction follows the dock and accepts an explicit back route", async () => {
  const session = await openPage({
    width: 850,
    height: 800,
    body: `<main><section class="page active" id="page-home"></section></main>`
  });
  try {
    const result = await session.page.evaluate(async () => {
      const page = document.querySelector(".page.active");
      const calls = [];
      document.startViewTransition = () => { calls.push("navigate"); throw new Error("navigate must not snapshot"); };
      let updated = 0;
      const travel = async (options) => {
        AstraMotion.navigate({ ...options, update() { updated += 1; } });
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return getComputedStyle(page).transform;
      };
      const forward = await travel({ from: "home", to: "library" });
      const back = await travel({ from: "settings", to: "search" });
      const explicit = await travel({ from: "settings", to: "settings", direction: "back" });
      return { forward, back, explicit, calls, updated };
    });
    assert.ok(translateX(result.forward) > 0, `moving later in the dock travels forward (${result.forward})`);
    assert.ok(translateX(result.back) < 0, `moving earlier in the dock travels back (${result.back})`);
    assert.ok(translateX(result.explicit) < 0, `an explicit back route stays back (${result.explicit})`);
    assert.equal(result.updated, 3, "route ownership commits immediately");
    assert.deepEqual(result.calls, [], "navigation does not start a view transition");
    assert.deepEqual(session.errors, []);
  } finally { await session.close(); }
});

test("shipped content choreography is viewport-aware and bounded", async () => {
  const session = await openPage({
    width: 850,
    height: 800,
    body: `<div id="rows" style="position:fixed;top:8px;left:8px;width:180px"></div>`
  });
  try {
    const states = await session.page.evaluate(async () => {
      const rows = document.querySelector("#rows");
      for (let index = 0; index < 16; index += 1) {
        const row = document.createElement("div");
        row.className = "video-row";
        row.style.cssText = "min-height:18px;height:18px;padding:0";
        rows.append(row);
      }
      const offscreen = document.createElement("div");
      offscreen.className = "stream-item";
      offscreen.style.cssText = "position:fixed;top:4000px;left:0;width:80px;height:20px";
      document.body.append(offscreen);
      AstraMotion.refresh(document);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return [...document.querySelectorAll(".video-row, .stream-item")].map((row) => ({
        kind: row.className,
        top: row.getBoundingClientRect().top,
        reveal: row.dataset.astraReveal || "",
        opacity: getComputedStyle(row).opacity
      }));
    });
    const visible = states.filter((row) => row.kind === "video-row" && row.top < 860);
    const animated = visible.filter((row) => row.reveal === "running");
    const finished = visible.filter((row) => row.reveal === "done");
    assert.ok(visible.length > 14, "enough rows are in view to pass the reveal budget");
    assert.ok(animated.length > 0 && animated.length <= 14, "only a bounded set of rows animates");
    assert.ok(finished.length >= visible.length - 14, "rows past the budget are revealed without waiting");
    assert.ok(animated.every((row) => Number(row.opacity) < 1));
    const parked = states.find((row) => row.kind === "stream-item");
    assert.equal(parked.reveal, "queued");
    assert.equal(parked.opacity, "1", "offscreen content is not promoted to an opacity layer");
    assert.deepEqual(session.errors, []);
  } finally { await session.close(); }
});

test("shipped mobile motion avoids offscreen GPU layers and costly document snapshots", async () => {
  const session = await openPage({
    width: 390,
    height: 800,
    touch: true,
    body: `<div class="video-row" id="row" style="min-height:18px;height:18px">row</div>
      <img class="media-image" id="shot" alt="" style="width:40px;height:40px">
      <div class="episode-nav-sticky" id="sticky">nav</div>`
  });
  try {
    const result = await session.page.evaluate(async () => {
      const calls = [];
      document.startViewTransition = () => { calls.push("snapshot"); return { updateCallbackDone: Promise.resolve(), finished: Promise.resolve() }; };
      const row = document.querySelector("#row");
      AstraMotion.refresh(row);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      AstraMotion.navigate({ from: "home", to: "library", update() {} });
      const image = getComputedStyle(document.querySelector("#shot"));
      return {
        lean: document.documentElement.classList.contains("motion-lean"),
        reveal: row.dataset.astraReveal,
        opacity: getComputedStyle(row).opacity,
        calls,
        imageTransform: image.transform,
        imageTransition: image.transitionDuration
      };
    });
    assert.equal(result.lean, true, "a narrow coarse device with few cores takes the lean path");
    assert.equal(result.reveal, "done");
    assert.equal(result.opacity, "1", "lean refresh does not fade the row through an opacity layer");
    assert.deepEqual(result.calls, [], "constrained motion does not snapshot the document");
    assert.equal(result.imageTransform, "none");
    assert.match(result.imageTransition, /0\.22s/);
    // The 419px query declares backdrop-filter: none on .episode-nav-sticky, but a
    // later rule of the same specificity sets saturate(180%) blur(20px) and wins.
    // Computed style at 390px is not none, so that clause is not claimed here.
    assert.deepEqual(session.errors, []);
  } finally { await session.close(); }
});

test("shipped direct interaction motion stays inside the 360ms release budget", async () => {
  const session = await openPage({
    width: 850,
    height: 800,
    clock: true,
    body: `<main><section class="page active" id="page-home"></section></main>
      <div class="seek-feedback show" id="seek">+10</div>
      <button class="btn" id="press" style="width:80px;height:40px">Go</button>`
  });
  try {
    const timing = await session.page.evaluate(() => {
      const page = document.querySelector(".page.active");
      const button = document.querySelector("#press");
      button.dispatchEvent(new PointerEvent("pointerdown", {
        pointerType: "touch", clientX: 8, clientY: 8, bubbles: true, cancelable: true, isPrimary: true, button: 0, pointerId: 1
      }));
      AstraMotion.navigate({ from: "home", to: "library", update() {} });
      const seekRule = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).find((rule) => rule.selectorText === ".seek-feedback.show");
      const artRule = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).find((rule) => rule.selectorText === "::view-transition-group(astra-art)");
      return {
        moving: getComputedStyle(page).transform,
        pressing: getComputedStyle(button).transform,
        seek: seekRule?.style.animationDuration || getComputedStyle(document.querySelector("#seek")).animationDuration,
        art: artRule?.style.animationDuration || ""
      };
    });
    assert.ok(translateX(timing.moving) > 0);
    assert.match(timing.seek, /0\.36s|360ms/);
    assert.match(timing.art, /0\.34s|340ms/);
    await session.page.clock.fastForward(360);
    const settled = await session.page.evaluate(() => ({
      page: getComputedStyle(document.querySelector(".page.active")).transform,
      press: getComputedStyle(document.querySelector("#press")).transform
    }));
    const pressScale = /^matrix\(/.test(settled.press) ? Number(settled.press.split(",")[0].slice(7)) : settled.press === "none" ? 1 : NaN;
    assert.ok(settled.page === "none" || Math.abs(translateX(settled.page)) < 0.5, `navigation release finishes within 360ms (${settled.page})`);
    assert.ok(
      Math.abs(pressScale - 1) < 0.02 || Math.abs(pressScale - 0.972) < 0.02,
      `the press response does not outlive the release budget (${settled.press})`
    );
    assert.deepEqual(session.errors, []);
  } finally { await session.close(); }
});

test("shipped view-transition callbacks cannot reorder or stall visible state", async () => {
  const session = await openPage({
    width: 850,
    height: 800,
    body: `<main><section class="page active" id="page-home"></section></main>`
  });
  try {
    const result = await session.page.evaluate(async () => {
      const calls = [];
      document.startViewTransition = (callback) => {
        calls.push("open");
        callback();
        return { updateCallbackDone: new Promise(() => {}), finished: new Promise(() => {}) };
      };
      const art = document.createElement("div");
      art.className = "art";
      art.style.cssText = "position:fixed;top:20px;left:20px;width:80px;height:80px";
      document.body.append(art);
      const opened = AstraMotion.sharedOpen({ source: art, update() { document.body.dataset.opened = "sync"; } });
      const beforeFallback = document.body.dataset.opened || "";
      await new Promise((resolve) => setTimeout(resolve, 180));
      document.startViewTransition = () => { throw new Error("view transition rejected"); };
      const poster = document.createElement("div");
      poster.className = "dossier-poster";
      poster.style.cssText = "position:fixed;top:30px;left:30px;width:90px;height:90px";
      document.body.append(poster);
      let threw = false;
      try {
        AstraMotion.sharedOpen({ source: art, targetSelector: ".dossier-poster", update() { document.body.dataset.fallback = "ran"; } });
      } catch { threw = true; }
      AstraMotion.navigate({ from: "library", to: "home", update() { document.body.dataset.nav = "now"; } });
      return {
        calls,
        beforeFallback,
        opened: await Promise.race([opened, Promise.resolve("pending")]),
        afterFallback: document.body.dataset.opened || "",
        threw,
        rejectedUpdate: document.body.dataset.fallback || "",
        nav: document.body.dataset.nav || "",
        pointer: getComputedStyle(document.documentElement, "::view-transition").pointerEvents
      };
    });
    assert.equal(result.beforeFallback, "sync", "the open update is not left waiting on the snapshot callback");
    assert.ok(result.calls.includes("open"));
    assert.equal(result.threw, false);
    assert.equal(result.rejectedUpdate, "ran", "a rejected view transition still commits the visible state");
    assert.equal(result.nav, "now");
    assert.equal(result.pointer, "none");
    assert.deepEqual(session.errors, []);
  } finally { await session.close(); }
});
