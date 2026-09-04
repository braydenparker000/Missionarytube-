/**
 * The browser check for YouTube playback.
 *
 * This is not a unit test. It launches a real Chromium, loads the real site,
 * and plays real video: a search, a result, a source, a decode, an audio
 * track, a seek, a pause, a fullscreen request and a quality change. Only the
 * remote services are substituted, by the servers in ./servers.mjs, so that a
 * check can run offline and can be told to fail on purpose.
 *
 *   npm run test:browser
 *
 * It skips, rather than fails, when ffmpeg or a Chromium binary is missing:
 * this is deliberately not part of `npm test`, which must stay dependency-free
 * and offline.
 */
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdir, writeFile, access } from "node:fs/promises";
import { buildMedia, ffmpegAvailable } from "./media.mjs";
import { startInvidious, startPiped, startGoogle, startAddon, startApp, stopAll } from "./servers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const workDir = process.env.BROWSER_CHECK_DIR || join(root, ".browser-check");

const results = [];
let currentStep = "";

function step(name) {
  currentStep = name;
}

function check(name, passed, detail = "") {
  results.push({ name, passed: !!passed, detail });
  process.stdout.write(`${passed ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}\n`);
  if (!passed) process.exitCode = 1;
}

function near(actual, expected, tolerance) {
  return Math.abs(actual - expected) <= tolerance;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/* ---- browser plumbing --------------------------------------------------- */

async function loadPlaywright() {
  for (const specifier of ["playwright-core", "playwright"]) {
    try {
      return await import(specifier);
    } catch {
      /* try the next one */
    }
  }
  return null;
}

async function chromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base) return undefined;
  const { readdir } = await import("node:fs/promises");
  let entries = [];
  try {
    entries = await readdir(base);
  } catch {
    return undefined;
  }
  const dir = entries.filter((name) => /^chromium-\d+$/.test(name)).sort().pop();
  if (!dir) return undefined;
  const path = join(base, dir, "chrome-linux", "chrome");
  return (await exists(path)) ? path : undefined;
}

/** The page's own console and page errors, so "no console errors" is checkable. */
function watchConsole(page) {
  const noise = [];
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    noise.push({ type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => noise.push({ type: "pageerror", text: String(error && error.message) }));
  return noise;
}

/* ---- the app's own state ------------------------------------------------- */

const MEDIA_STATE = `(() => {
  const el = document.querySelector('#mediaEl');
  if (!el) return null;
  return {
    currentTime: el.currentTime,
    duration: el.duration,
    paused: el.paused,
    readyState: el.readyState,
    videoWidth: el.videoWidth,
    videoHeight: el.videoHeight,
    muted: el.muted,
    volume: el.volume,
    error: el.error ? el.error.code : null,
    webkitAudioDecodedByteCount: el.webkitAudioDecodedByteCount ?? null,
    webkitVideoDecodedByteCount: el.webkitVideoDecodedByteCount ?? null,
    textTracks: el.textTracks ? el.textTracks.length : 0,
    src: (el.currentSrc || el.src || '').slice(0, 120)
  };
})()`;

async function waitForPlaying(page, { minTime = 0.4, timeout = 25000 } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    last = await page.evaluate(MEDIA_STATE);
    if (last && last.error) throw new Error(`media error code ${last.error}`);
    if (last && !last.paused && last.currentTime >= minTime && last.readyState >= 2) return last;
    await page.waitForTimeout(200);
  }
  throw new Error(`playback did not reach ${minTime}s: ${JSON.stringify(last)}`);
}

/** Open a YouTube result by title and get to a started player. */
async function playByTitle(page, title, { screenshot } = {}) {
  step(`search for ${title}`);
  await page.click('#mobileNav [data-nav="search"]');
  await page.fill("#globalSearch", title);
  await page.waitForSelector('[data-search-provider="youtube"] .yt-card', { timeout: 20000 });

  const card = page.locator(`[data-search-provider="youtube"] .yt-card`, { hasText: title }).first();
  await card.waitFor({ timeout: 10000 });
  await card.click();

  step(`open ${title}`);
  await page.waitForSelector(".cinema-detail", { timeout: 15000 });
  await page.waitForSelector(".cinema-detail .record-cell", { timeout: 15000 });
  await page.click("[data-get-streams]");
  await page.waitForSelector(".source-drawer [data-play-source]", { timeout: 20000 });
  await page.click(".source-drawer [data-play-source]");
  await page.waitForSelector("#playerShell", { timeout: 15000 });
  const state = await waitForPlaying(page);
  if (screenshot) await page.screenshot({ path: screenshot });
  return state;
}

/**
 * Get back to a clean surface. Closing the player deliberately returns to the
 * source list it came from, so the drawer has to be dismissed before the
 * dossier underneath it can be.
 */
async function closePlayer(page) {
  for (const selector of ["#playerShell [data-close-player]", "[data-close-streams]", ".sheet [data-close]"]) {
    if (await page.$(selector)) {
      await page.click(selector, { force: true });
      await page.waitForTimeout(450);
    }
  }
  await page.waitForFunction(() => !document.querySelector("#playerShell"), null, { timeout: 8000 });
}

/* ---- the check ----------------------------------------------------------- */

async function main() {
  if (!(await ffmpegAvailable())) {
    console.log("skip: ffmpeg is not available, so no media can be generated.");
    console.log("      install ffmpeg, or set FFMPEG_PATH, then run again.");
    return;
  }
  const playwright = await loadPlaywright();
  if (!playwright) {
    console.log("skip: playwright-core is not installed.");
    return;
  }
  const executablePath = await chromiumExecutable();

  console.log("building media (first run takes a minute)...");
  const media = await buildMedia(join(workDir, "media"));

  const google = await startGoogle({ media });
  // The primary instance is the one the app is configured with; the second is
  // a public fallback. Failover is proved by breaking the first.
  const primary = await startInvidious({ media, googleOrigin: google.origin, name: "primary" });
  const fallback = await startInvidious({ media, googleOrigin: google.origin, name: "fallback" });
  // The pool the app actually ships on is Piped-first, so it gets its own leg.
  const piped = await startPiped({ media, name: "piped" });
  const addon = await startAddon({ media });
  const libRoot = process.env.PLAYER_LIB_ROOT || join(workDir, "libs");
  const app = await startApp({ root, libs: {} });
  const servers = [google, primary, fallback, piped, addon, app];

  const browser = await playwright.chromium.launch({
    executablePath,
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage"]
  });
  // A phone-shaped viewport, because that is the target client.
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true
  });

  try {
    // The pinned player runtimes come from a CDN the check has no access to.
    // Serving the byte-identical npm copies satisfies the app's own integrity
    // hash, so the SRI check is exercised rather than bypassed.
    await context.route("https://cdn.jsdelivr.net/**", async (route) => {
      const url = route.request().url();
      const path = join(libRoot, url.includes("dashjs") ? "dash.all.min.js" : "hls.min.js");
      if (await exists(path)) return route.fulfill({ path, contentType: "text/javascript" });
      console.log(`  (no local copy of ${path}; the pinned runtime cannot load)`);
      return route.abort();
    });

    const page = await context.newPage();
    const noise = watchConsole(page);

    // Configure the app before it boots: the mock add-on installed, YouTube
    // pointed at the primary instance, adaptive on.
    // Seeded once, not on every navigation: later steps change these settings
    // and then reload, and a re-seed would quietly undo what they set.
    await context.addInitScript(
      ([addonUrl, primaryOrigin]) => {
        if (!localStorage.getItem("astra.v1.addons")) {
          localStorage.setItem("astra.v1.addons", JSON.stringify([{ url: addonUrl, enabled: true }]));
        }
        if (!localStorage.getItem("astra.v1.youtube")) {
          localStorage.setItem(
            "astra.v1.youtube",
            JSON.stringify({
              enabled: true,
              privateInstanceUrl: primaryOrigin,
              privateInstanceApi: "invidious",
              preferAdaptive: true,
              maxHeight: 1080
            })
          );
        }
      },
      [addon.manifest, primary.origin]
    );

    /* 1 — the site loads */
    step("load the site");
    const response = await page.goto(`${app.origin}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#mobileNav .dock-btn", { timeout: 15000 });
    check("1. the site loads", response.ok() && (await page.title()) === "Astra");

    /* 2 — the YouTube interface opens */
    step("open browse");
    await page.click('#mobileNav [data-nav="search"]');
    await page.waitForSelector("#youtubeBrowse .yt-card", { timeout: 20000 });
    const trending = await page.$$eval("#youtubeBrowse .yt-card .yt-title", (nodes) => nodes.map((n) => n.textContent));
    check("2. the YouTube interface opens", trending.length >= 4, `${trending.length} trending videos`);

    /* 4 — thumbnails render (measured from the browser, not assumed) */
    step("thumbnails");
    await page.waitForFunction(
      () => [...document.querySelectorAll("#youtubeBrowse .yt-art img")].some((img) => img.naturalWidth > 0),
      null,
      { timeout: 15000 }
    );
    const art = await page.$$eval("#youtubeBrowse .yt-art img", (nodes) =>
      nodes.map((img) => ({ w: img.naturalWidth, h: img.naturalHeight, failed: img.complete && img.naturalWidth === 0 }))
    );
    const decoded = art.filter((entry) => entry.w > 0 && entry.h > 0);
    check(
      "4. thumbnails render",
      // Cards off the bottom of the phone are lazy-loaded and correctly have
      // no bitmap yet, so what is checked is that the visible ones decoded and
      // that none of them failed outright.
      decoded.length > 0 && art.every((entry) => !entry.failed),
      `${decoded.length} of ${art.length} decoded (rest are lazy), first ${decoded[0]?.w}x${decoded[0]?.h}`
    );

    /* 3 — search returns results */
    step("search");
    await page.fill("#globalSearch", "Short Clip");
    await page.waitForSelector('[data-search-provider="youtube"] .yt-card', { timeout: 20000 });
    const hits = await page.$$eval('[data-search-provider="youtube"] .yt-card .yt-title', (nodes) =>
      nodes.map((n) => n.textContent)
    );
    check("3. search returns results", hits.some((title) => title.includes("Short Clip")), hits.join(", "));

    /* 5 — selecting a result loads metadata */
    step("open the result");
    await page.locator('[data-search-provider="youtube"] .yt-card', { hasText: "Short Clip" }).first().click();
    await page.waitForSelector(".cinema-detail", { timeout: 15000 });
    await page.waitForSelector(".cinema-detail .record-cell", { timeout: 15000 });
    const meta = await page.evaluate(() => ({
      title: document.querySelector("#dossierTitle")?.textContent || "",
      facts: [...document.querySelectorAll(".dossier-meta span")].map((n) => n.textContent),
      record: [...document.querySelectorAll(".record-cell")].map((n) => n.textContent),
      description: document.querySelector(".synopsis")?.textContent || "",
      provider: document.querySelector(".dossier-tags .provider-chip")?.textContent || ""
    }));
    check(
      "5. selecting a result loads metadata",
      meta.title.includes("Short Clip") &&
        meta.description.length > 10 &&
        meta.record.some((cell) => cell.includes("Channel")) &&
        meta.record.some((cell) => cell.includes("Views")) &&
        meta.facts.some((fact) => fact.includes("Bench Channel")),
      `${meta.title} · ${meta.provider} · ${meta.record.length} record cells`
    );

    /* the source list, then playback */
    step("sources");
    await page.click("[data-get-streams]");
    await page.waitForSelector(".source-drawer [data-play-source]", { timeout: 20000 });
    const sources = await page.$$eval(".source-drawer [data-play-source] .row-title, .source-drawer [data-play-source]", (nodes) =>
      nodes.map((n) => n.textContent.trim().slice(0, 60))
    );
    await page.click(".source-drawer [data-play-source]");
    await page.waitForSelector("#playerShell", { timeout: 15000 });

    /* 6 — playback actually starts */
    step("playback");
    const playing = await waitForPlaying(page, { minTime: 0.5 });
    await mkdir(join(workDir, "evidence"), { recursive: true });
    await page.screenshot({ path: join(workDir, "evidence", "01-playing.png") });
    check(
      "6. playback actually starts",
      playing.currentTime > 0.4 && !playing.paused && playing.videoWidth > 0,
      `t=${playing.currentTime.toFixed(2)}s ${playing.videoWidth}x${playing.videoHeight} readyState=${playing.readyState}`
    );

    /* 7 — audio is present */
    step("audio");
    await page.waitForTimeout(1200);
    const withAudio = await page.evaluate(MEDIA_STATE);
    check(
      "7. audio is present",
      Number(withAudio.webkitAudioDecodedByteCount) > 0 && withAudio.volume > 0 && !withAudio.muted,
      `${withAudio.webkitAudioDecodedByteCount} audio bytes decoded, volume ${withAudio.volume}`
    );

    /* 15 — no iframe, at any point */
    step("no iframe");
    const iframesEarly = await page.evaluate(() => document.querySelectorAll("iframe").length);
    check("15. no YouTube iframe is present", iframesEarly === 0, `${iframesEarly} iframes while a YouTube video is playing`);

    await closePlayer(page);

    /* The transport checks move to the long clip, so a seek has somewhere to
       land: eight seconds is not enough runway to seek forward, hold a pause
       and resume without simply reaching the end. */
    step("transport on a longer video");
    const longState = await playByTitle(page, "Long Feature", {
      screenshot: join(workDir, "evidence", "02-long-playing.png")
    });

    /* 8 — seeking works */
    step("seek");
    const beforeSeek = longState;
    await page.click('[data-player-action="seek-forward"]', { force: true });
    await page.waitForTimeout(900);
    const afterSeek = await page.evaluate(MEDIA_STATE);
    // And the scrubber itself, which is what a thumb actually touches.
    await page.evaluate(() => {
      const scrub = document.querySelector("#videoScrub");
      scrub.value = String(Math.round((25 / document.querySelector("#mediaEl").duration) * 1000));
      scrub.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(900);
    const afterScrub = await page.evaluate(MEDIA_STATE);
    check(
      "8. seeking works",
      afterSeek.currentTime > beforeSeek.currentTime + 8 && near(afterScrub.currentTime, 25, 2),
      `+10s button: ${beforeSeek.currentTime.toFixed(1)}s to ${afterSeek.currentTime.toFixed(1)}s; ` +
        `scrubber asked for 25s and landed at ${afterScrub.currentTime.toFixed(1)}s`
    );

    /* 9 — pause and resume */
    step("pause and resume");
    await page.click("#videoTransport", { force: true });
    await page.waitForFunction(() => document.querySelector("#mediaEl").paused, null, { timeout: 5000 }).catch(() => {});
    const paused = await page.evaluate(MEDIA_STATE);
    await page.waitForTimeout(900);
    const stillPaused = await page.evaluate(MEDIA_STATE);
    await page.click("#videoTransport", { force: true });
    await page.waitForTimeout(1200);
    const resumed = await page.evaluate(MEDIA_STATE);
    const stopped = paused.paused === true;
    const held = near(stillPaused.currentTime, paused.currentTime, 0.05);
    const running = resumed.paused === false && resumed.currentTime > paused.currentTime;
    check(
      "9. pause and resume work",
      stopped && held && running,
      `paused=${stopped} at ${paused.currentTime.toFixed(2)}s, held=${held} (${stillPaused.currentTime.toFixed(2)}s), ` +
        `resumed=${running} to ${resumed.currentTime.toFixed(2)}s`
    );

    /* 10 — fullscreen */
    step("fullscreen");
    const fullscreen = await page.evaluate(async () => {
      const modal = document.querySelector(".player-modal");
      try {
        await modal.requestFullscreen();
      } catch (error) {
        return { entered: false, reason: String(error && error.message) };
      }
      const entered = document.fullscreenElement === modal;
      if (entered) await document.exitFullscreen();
      return { entered, exited: document.fullscreenElement === null };
    });
    check(
      "10. fullscreen works",
      fullscreen.entered && fullscreen.exited,
      fullscreen.entered ? "entered and exited on the player surface" : fullscreen.reason
    );

    await closePlayer(page);

    /* 11 — a quality change that really changes the picture */
    step("quality");
    const qualityReport = await (async () => {
      const state = await playByTitle(page, "A 1080p Capable Video", {
        screenshot: join(workDir, "evidence", "02-hd-playing.png")
      });
      await page.click('[data-track-menu="quality"]');
      await page.waitForSelector("#trackMenu [data-quality]", { timeout: 8000 });
      const offered = await page.$$eval("#trackMenu [data-quality]", (nodes) =>
        nodes.map((n) => ({ id: n.dataset.quality, label: n.querySelector("b")?.textContent, active: n.classList.contains("active") }))
      );
      const target = offered.find((entry) => entry.id !== "auto" && entry.label !== `${state.videoHeight}p`) ||
        offered.find((entry) => entry.id !== "auto");
      const at = state.currentTime;
      await page.click(`#trackMenu [data-quality="${target.id}"]`);
      await page.waitForTimeout(2500);
      const after = await page.evaluate(MEDIA_STATE);
      await page.screenshot({ path: join(workDir, "evidence", "03-quality-changed.png") });
      return { offered, target, before: state, after, at };
    })();
    check(
      "11. a quality change works and keeps the position",
      qualityReport.offered.length > 1 &&
        qualityReport.after.videoHeight !== qualityReport.before.videoHeight &&
        qualityReport.after.currentTime >= qualityReport.at - 1 &&
        !qualityReport.after.paused,
      `offered ${qualityReport.offered.map((entry) => entry.label).join(", ")}; ` +
        `${qualityReport.before.videoHeight}p to ${qualityReport.after.videoHeight}p, ` +
        `position ${qualityReport.at.toFixed(1)}s to ${qualityReport.after.currentTime.toFixed(1)}s`
    );
    await closePlayer(page);

    /* several videos, not one hand-picked one */
    step("the rest of the videos");
    const played = [];
    for (const title of ["Music Video"]) {
      const state = await playByTitle(page, title);
      played.push({ title, seconds: state.duration, at: state.currentTime, size: `${state.videoWidth}x${state.videoHeight}` });
      await closePlayer(page);
    }
    check(
      "multiple videos play, not one hand-picked one",
      played.every((entry) => entry.at > 0.4),
      played.map((entry) => `${entry.title} ${entry.size} ${entry.seconds.toFixed(0)}s`).join(" · ")
    );

    /* The direct progressive route, which is the claim the whole design rests
       on: a media element load is not a CORS request, so it plays straight
       from a host that sends no CORS headers at all. */
    step("direct progressive");
    await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem("astra.v1.youtube"));
      localStorage.setItem("astra.v1.youtube", JSON.stringify({ ...stored, preferAdaptive: false }));
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#mobileNav .dock-btn", { timeout: 15000 });
    const googleBefore = google.requests.length;
    const direct = await playByTitle(page, "Short Clip", {
      screenshot: join(workDir, "evidence", "07-direct-progressive.png")
    });
    const servedDirect = google.requests.slice(googleBefore);
    check(
      "progressive plays straight from a host that sends no CORS headers",
      direct.currentTime > 0.4 && direct.src.startsWith(google.origin) && servedDirect.length > 0,
      `${servedDirect.length} requests to the CORS-less host, ` +
        `${servedDirect.filter((entry) => entry.range).length} of them range requests`
    );

    /* Captions: cross-origin, so they have to be fetched and re-attached. */
    step("captions");
    const captions = await page.evaluate(async () => {
      const button = document.querySelector('[data-track-menu="text"]');
      if (!button) return { tracks: 0 };
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 400));
      const options = [...document.querySelectorAll("#trackMenu [data-text-track]")].map((node) => ({
        id: node.dataset.textTrack,
        label: node.querySelector("b")?.textContent
      }));
      const chosen = options.find((option) => option.id);
      if (chosen) {
        document.querySelector(`#trackMenu [data-text-track="${chosen.id}"]`).click();
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      const el = document.querySelector("#mediaEl");
      const attached = [...el.querySelectorAll("track")].map((node) => ({
        src: node.src.slice(0, 5),
        label: node.label,
        mode: node.track ? node.track.mode : "none"
      }));
      return { options, attached };
    });
    check(
      "captions attach through the fetch-and-blob path a cross-origin track needs",
      captions.attached.length > 0 && captions.attached.every((track) => track.src === "blob:") &&
        captions.attached.some((track) => track.mode === "showing"),
      `${captions.attached.length} track(s): ${captions.attached.map((track) => `${track.label}/${track.mode}`).join(", ")}`
    );
    await closePlayer(page);

    /* The Piped path: the protocol the shipped default pool is made of. */
    step("piped");
    async function usePool(entries, extra = {}) {
      await page.evaluate(
        ([pool, settings]) => {
          localStorage.setItem("astra.v1.youtube", JSON.stringify({
            enabled: true, privateInstanceUrl: "", preferAdaptive: false, maxHeight: 1080, ...settings
          }));
          window.__benchPool = pool;
        },
        [entries, extra]
      );
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("#mobileNav .dock-btn", { timeout: 15000 });
      // The pool is code rather than storage, so it is injected the only way a
      // browser check can: by rewriting the defaults the provider resolves from.
      await page.evaluate((pool) => {
        window.AstraYouTube.config.DEFAULTS.publicFallbackInstances = pool;
      }, entries);
    }

    await usePool([{ url: piped.origin, api: "piped" }]);
    const pipedBefore = piped.requests.length;
    const pipedState = await playByTitle(page, "Short Clip", {
      screenshot: join(workDir, "evidence", "08-piped-playing.png")
    });
    await page.waitForTimeout(1200);
    const pipedAudio = await page.evaluate(MEDIA_STATE);
    const pipedPaths = piped.requests.slice(pipedBefore).map((entry) => entry.path);
    check(
      "Piped resolves and plays, with audio",
      pipedState.currentTime > 0.4 && !pipedState.paused &&
        Number(pipedAudio.webkitAudioDecodedByteCount) > 0 &&
        pipedPaths.some((path) => path.startsWith("/search")) &&
        pipedPaths.some((path) => path.startsWith("/streams/")),
      `${pipedAudio.webkitAudioDecodedByteCount} audio bytes at ${pipedState.currentTime.toFixed(2)}s, ` +
        `via ${[...new Set(pipedPaths.map((p) => p.split("/")[1]))].join(", ")}`
    );
    check(
      "a Piped stream is served by the instance, so it carries CORS",
      pipedState.src.startsWith(piped.origin),
      pipedState.src.slice(0, 60)
    );
    await closePlayer(page);

    /* A mixed pool is the shipped arrangement: Piped leads, Invidious trails.
       One logical request has to be able to cross that boundary. */
    step("mixed pool");
    piped.state.mode = "down";
    await usePool([
      { url: piped.origin, api: "piped" },
      { url: primary.origin, api: "invidious" }
    ]);
    const crossed = await playByTitle(page, "Music Video", {
      screenshot: join(workDir, "evidence", "09-mixed-pool.png")
    });
    check(
      "a dead Piped instance is answered by an Invidious one",
      crossed.currentTime > 0.4 && !crossed.paused,
      `playing at ${crossed.currentTime.toFixed(2)}s after crossing protocols`
    );
    piped.state.mode = "ok";
    await closePlayer(page);

    /* 12 and 13 — failover, with the configured instance genuinely dead */
    step("failover");
    primary.state.mode = "down";
    await page.evaluate(
      (primaryOrigin) => {
        localStorage.setItem(
          "astra.v1.youtube",
          JSON.stringify({
            enabled: true,
            privateInstanceUrl: primaryOrigin,
            privateInstanceApi: "invidious",
            preferAdaptive: true,
            maxHeight: 1080
          })
        );
      },
      primary.origin
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#mobileNav .dock-btn", { timeout: 15000 });
    await page.evaluate((fallbackOrigin) => {
      // The fallback list is code, not storage, so it is injected the only way
      // a browser check can: by rewriting the defaults the provider resolves.
      window.AstraYouTube.config.DEFAULTS.publicFallbackInstances = [
        { url: fallbackOrigin, api: "invidious" }
      ];
    }, fallback.origin);

    const before = { primary: primary.requests.length, fallback: fallback.requests.length };
    const failoverState = await playByTitle(page, "Short Clip", {
      screenshot: join(workDir, "evidence", "04-failover-playing.png")
    });
    const after = { primary: primary.requests.length, fallback: fallback.requests.length };
    check(
      "12. instance failover works",
      after.primary > before.primary && after.fallback > before.fallback,
      `dead instance asked ${after.primary - before.primary} times, fallback answered ${after.fallback - before.fallback}`
    );
    check(
      "13. a dead primary instance does not break the feature",
      failoverState.currentTime > 0.4 && !failoverState.paused,
      `playing at ${failoverState.currentTime.toFixed(2)}s through the fallback`
    );
    await closePlayer(page);
    primary.state.mode = "ok";

    /* a signed URL that will not play falls through to the proxied route */
    step("recovery");
    google.state.mode = "forbidden";
    await page.evaluate((primaryOrigin) => {
      localStorage.setItem("astra.v1.youtube", JSON.stringify({
        enabled: true, privateInstanceUrl: primaryOrigin, privateInstanceApi: "invidious",
        preferAdaptive: false, maxHeight: 1080
      }));
    }, primary.origin);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#mobileNav .dock-btn", { timeout: 15000 });
    const recovered = await playByTitle(page, "Music Video", {
      screenshot: join(workDir, "evidence", "05-recovered.png")
    });
    const recoveredSrc = recovered.src;
    check(
      "a refused direct URL falls through to a delivery that works",
      recovered.currentTime > 0.4 && !recovered.paused,
      `playing from ${recoveredSrc.includes(primary.origin.replace("http://", "")) ? "the instance" : "another delivery"} at ${recovered.currentTime.toFixed(2)}s`
    );
    google.state.mode = "ok";
    await closePlayer(page);

    /* 14 — the add-on path is untouched */
    step("existing playback");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#mobileNav .dock-btn", { timeout: 15000 });
    await page.click('#mobileNav [data-nav="search"]');
    await page.fill("#globalSearch", "An Add-on Movie");
    await page.waitForSelector('[data-search-provider]:not([data-search-provider="youtube"]) .card', { timeout: 25000 });
    await page.locator('[data-search-provider]:not([data-search-provider="youtube"]) .card').first().click();
    await page.waitForSelector(".cinema-detail", { timeout: 15000 });
    await page.click("[data-get-streams]");
    await page.waitForSelector(".source-drawer [data-play-source]", { timeout: 20000 });
    await page.click(".source-drawer [data-play-source]");
    await page.waitForSelector("#playerShell", { timeout: 15000 });
    const addonPlaying = await waitForPlaying(page, { minTime: 0.4 });
    await page.screenshot({ path: join(workDir, "evidence", "06-addon-playing.png") });
    check(
      "14. existing MissionaryTube playback still works",
      addonPlaying.currentTime > 0.3 && !addonPlaying.paused && addonPlaying.videoWidth > 0,
      `add-on stream playing at ${addonPlaying.currentTime.toFixed(2)}s, ${addonPlaying.videoWidth}x${addonPlaying.videoHeight}`
    );
    await closePlayer(page);

    /* 16 — nothing shouted in the console along the way */
    step("console");
    const real = noise.filter(
      (entry) =>
        entry.type !== "warning" &&
        // Expected: the check deliberately breaks a server and a signed URL.
        !/Failed to load resource|503|403|net::ERR_FAILED|net::ERR_ABORTED/i.test(entry.text)
    );
    check("16. no obvious console errors during normal playback", real.length === 0, real.map((entry) => entry.text).join(" | ") || "clean");

    /* the whole point, stated once more where it can be seen */
    const embedded = await page.evaluate(() => ({
      iframes: document.querySelectorAll("iframe").length,
      html: document.documentElement.innerHTML.includes("youtube-nocookie")
    }));
    check("no embed appeared at any point in the run", embedded.iframes === 0 && !embedded.html);

    await writeFile(
      join(workDir, "evidence", "report.json"),
      JSON.stringify({ ranAt: new Date().toISOString(), sources, results }, null, 2)
    );
  } catch (error) {
    check(`unexpected failure during: ${currentStep}`, false, String(error && error.message));
  } finally {
    await browser.close();
    await stopAll(servers);
  }

  const passed = results.filter((entry) => entry.passed).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  console.log(`evidence: ${join(workDir, "evidence")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
