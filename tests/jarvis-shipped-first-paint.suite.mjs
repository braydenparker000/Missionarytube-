import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { mediaAppRoot } from "./helpers/media-root.mjs";
import { readMediaSource } from "../scripts/media-source.mjs";

if (!process.env.MEDIA_APP_ROOT) {
  throw new Error("Refusing to read the repo-root media copy. This suite requires MEDIA_APP_ROOT set to the exact Jarvis media source.");
}

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const mediaRoot = mediaAppRoot();
const mediaSource = readMediaSource(repoRoot);
const mediaTree = execFileSync("git", ["-C", repoRoot, "rev-parse", `${mediaSource.commit}:${mediaSource.path}`], { encoding: "utf8" }).trim();
const pin = JSON.parse(readFileSync(resolve(repoRoot, "jarvis-release.json"), "utf8"));

const chrome = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"].find((path) => path && existsSync(path));
if (!chrome) throw new Error("Chrome is required to characterize the shipped Jarvis first paint. Set CHROME_PATH.");
const { chromium } = createRequire(import.meta.url)("playwright-core");

const STORED = Object.freeze({
  accent: "violet",
  motion: "off",
  surface: "charcoal",
  density: "comfortable",
  glass: "glass"
});
const STORAGE_KEY = "astra.v1.appearance";
const EVIDENCE = resolve(repoRoot, "test-evidence/media-migration/first-paint");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json",
  ".woff2": "font/woff2"
};

function startServer(root) {
  const prefix = root.endsWith(sep) ? root : root + sep;
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (rel.endsWith("/")) rel = rel.slice(0, -1);
    let file = rel ? normalize(join(root, rel)) : root;
    if (file !== root && !file.startsWith(prefix)) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404);
      response.end("missing");
      return;
    }
    response.writeHead(200, {
      "content-type": MIME[extname(file)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      resolveServer({ server, origin: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function readPaint(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const brand = document.querySelector(".brand-orbit");
    const pageEl = document.querySelector(".page.active");
    const brandStyle = brand ? getComputedStyle(brand) : null;
    const pageStyle = pageEl ? getComputedStyle(pageEl) : null;
    return {
      readyState: document.readyState,
      appearanceDefined: typeof AstraAppearance !== "undefined",
      appearance: typeof AstraAppearance !== "undefined" ? AstraAppearance.get() : null,
      className: root.className,
      dataset: { ...root.dataset },
      stored: localStorage.getItem("astra.v1.appearance"),
      accent: getComputedStyle(root).getPropertyValue("--accent").trim(),
      accentFill: getComputedStyle(root).getPropertyValue("--accent-fill").trim(),
      background: getComputedStyle(root).backgroundColor,
      brandColor: brandStyle ? brandStyle.color : null,
      pageAnimation: pageStyle ? pageStyle.animationName : null,
      pageAnimationDuration: pageStyle ? pageStyle.animationDuration : null,
      paints: performance.getEntriesByType("paint").map((entry) => entry.name),
      completedScripts: performance.getEntriesByType("resource").filter((entry) => entry.name.includes(".js")).length
    };
  });
}

test("characterization: held scripts leave the stored accent and motion unapplied at first paint", { timeout: 30000 }, async () => {
  // public/media/index.html requests /assets/pip-diagnostics.js from the site
  // root, so the server has to be the pinned public/ tree and the page /media/.
  const siteRoot = resolve(mediaRoot, "..");
  const host = await startServer(siteRoot);
  const browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await context.addInitScript((stored) => {
      localStorage.setItem("astra.v1.appearance", stored);
    }, JSON.stringify(STORED));
    const page = await context.newPage();
    const heldRoutes = [];
    const heldPaths = [];
    let pipStatus = null;
    let releaseScripts = false;
    page.on("response", (response) => {
      const pathname = new URL(response.url()).pathname;
      if (pathname === "/assets/pip-diagnostics.js") pipStatus = response.status();
    });
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (!url.startsWith(host.origin)) return route.abort();
      if (!releaseScripts && url.includes(".js")) {
        heldRoutes.push(route);
        heldPaths.push(new URL(url).pathname);
        return undefined;
      }
      return route.continue();
    });
    await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "dark" });
    await page.goto(`${host.origin}/media/`, { waitUntil: "commit", timeout: 10000 });
    await page.waitForFunction(() => {
      const paints = performance.getEntriesByType("paint").map((entry) => entry.name);
      const background = getComputedStyle(document.documentElement).backgroundColor;
      return document.querySelector(".brand-orbit")
        && paints.includes("first-contentful-paint")
        && document.styleSheets.length >= 3
        && background !== "rgba(0, 0, 0, 0)";
    }, null, { timeout: 15000 });
    const heldCount = heldRoutes.length;
    const held = await readPaint(page);
    mkdirSync(EVIDENCE, { recursive: true });
    const heldShot = resolve(EVIDENCE, "held.png");
    const releasedShot = resolve(EVIDENCE, "released.png");
    // page.screenshot waits on document.fonts.ready, which waits for the load
    // event, which waits for these deferred scripts. Capture through CDP instead.
    const capture = async (path) => {
      const client = await page.context().newCDPSession(page);
      const shot = await client.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(path, Buffer.from(shot.data, "base64"));
      await client.detach();
    };
    await capture(heldShot);

    releaseScripts = true;
    await Promise.all(heldRoutes.splice(0).map((route) => route.continue()));
    await page.waitForFunction(() => {
      return document.documentElement.dataset.accent === "violet"
        && document.documentElement.dataset.motion === "off"
        && typeof AstraAppearance !== "undefined";
    }, null, { timeout: 15000 });
    const released = await readPaint(page);
    await capture(releasedShot);

    const limitation = "Stored violet accent and motion off were present in localStorage under astra.v1.appearance, and the document had already painted, while every requested script response was still held. appearance.js is deferred, so that paint used the stylesheet default ice accent (#b4d1ff) and .page.active was still running page-arrival. The stored accent, surface, and motion were applied only after the script responses were released.";
    const report = {
      jarvisCommit: pin.commit,
      mediaTree,
      mediaSource: {repository:mediaSource.repository,commit:mediaSource.commit,path:mediaSource.path,tree:mediaSource.tree},
      storageKey: STORAGE_KEY,
      stored: STORED,
      defaults: { accent: "ice", accentColor: "#b4d1ff", motion: "full", surface: "black" },
      layout: {
        siteRoot: "public",
        pagePath: "/media/",
        pipDiagnostics: "/assets/pip-diagnostics.js",
        pipDiagnosticsStatus: pipStatus
      },
      viewport: { width: 390, height: 844 },
      heldScriptRequestsAtPaint: heldCount,
      beforeFirstPaintGuarantee: false,
      limitation,
      held,
      released,
      screenshots: {
        held: "test-evidence/media-migration/first-paint/held.png",
        released: "test-evidence/media-migration/first-paint/released.png"
      }
    };
    writeFileSync(resolve(EVIDENCE, "computed-style.json"), `${JSON.stringify(report, null, 2)}\n`);

    assert.equal(pin.commit, "c28c1b2f70aabb5217b08bf31ffe4c93d0353765");
    assert.equal(mediaSource.repository, "braydenparker000/Missionarytube-");
    assert.equal(mediaSource.path, "jarvis/public/media");
    assert.equal(mediaSource.commit, "7520eeaea05825ef8edafc5882ef4e053e99f26d");
    assert.equal(mediaTree, "c4d89e4aab446f6f79b17b7df911ec3c3f59e4d7");
    assert.equal(new URL(page.url()).pathname, "/media/");
    assert.ok(heldPaths.includes("/assets/pip-diagnostics.js"), "the page requests /assets/pip-diagnostics.js from the site root");
    assert.equal(pipStatus, 200, "/assets/pip-diagnostics.js is served from public/assets");
    assert.ok(heldCount >= 20, `script responses were held at first paint (${heldCount})`);
    assert.equal(held.appearanceDefined, false);
    assert.equal(held.completedScripts, 0);
    assert.equal(held.readyState, "interactive");
    assert.ok(held.paints.includes("first-contentful-paint"));
    assert.equal(held.stored, JSON.stringify(STORED));
    assert.equal(held.dataset.accent, undefined);
    assert.equal(held.dataset.motion, undefined);
    assert.equal(held.dataset.surface, undefined);
    assert.equal(held.className, "");
    assert.equal(held.accent, "#b4d1ff");
    assert.equal(held.accentFill, "#245dd9");
    assert.equal(held.brandColor, "rgb(180, 209, 255)");
    assert.equal(held.pageAnimation, "page-arrival");
    assert.equal(report.beforeFirstPaintGuarantee, false);
    assert.match(report.limitation, /were applied only after the script responses were released/);

    assert.equal(released.appearanceDefined, true);
    assert.equal(released.dataset.accent, "violet");
    assert.equal(released.dataset.motion, "off");
    assert.equal(released.dataset.surface, "charcoal");
    assert.equal(released.appearance.accent, "violet");
    assert.equal(released.appearance.motion, "off");
    assert.equal(released.accent, "#cbbaff");
    assert.equal(released.accentFill, "#6748bb");
    assert.equal(released.brandColor, "rgb(203, 186, 255)");
    assert.equal(released.pageAnimation, "none");
    assert.match(released.className, /\bjs\b/);
    assert.ok(released.completedScripts > held.completedScripts);

    for (const path of [heldShot, releasedShot]) {
      const bytes = statSync(path).size;
      assert.ok(bytes > 1000, `${path} is a non-empty screenshot`);
    }
  } finally {
    await browser.close();
    await new Promise((done) => host.server.close(done));
  }
});

test("stored non-default accent and motion are applied before first paint", {
  todo: "appearance.js and bootstrap.js are deferred. While their responses are held, the first paint uses the stylesheet default ice accent (#b4d1ff) and .page.active still runs page-arrival. The stored violet accent and motion off are applied only after the scripts run. The characterization in this file records that limitation and does not treat it as a passing guarantee."
}, () => {});
