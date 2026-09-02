import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const output = new URL("../dist/", import.meta.url);
const rootFiles = new Set(["favicon.ico", "manifest.webmanifest", "robots.txt", "sitemap.xml"]);
const assetDirectories = ["assets"];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (extname(entry.name) !== ".html" && !rootFiles.has(entry.name)) continue;
  await cp(new URL(entry.name, root), new URL(entry.name, output));
}

for (const directory of assetDirectories) {
  try {
    await cp(new URL(`${directory}/`, root), new URL(`${directory}/`, output), {
      recursive: true
    });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

// The interaction layer is compiled locally from exact npm pins. The browser
// never reaches a mutable CDN, and the rest of Astra stays framework-free.
await build({
  entryPoints: [new URL("../src/astra-motion.js", import.meta.url).pathname],
  outfile: new URL("../dist/assets/js/astra-motion.js", import.meta.url).pathname,
  bundle: true,
  minify: true,
  format: "iife",
  target: ["chrome120"],
  legalComments: "inline",
  banner: { js: "/*! Astra Motion · GSAP 3.15.0 · https://gsap.com/licensing/ */" }
});

// The release meta value is Astra's single version source. Source files keep a
// readable placeholder; the production build gives every local asset the same
// cache key and refuses to ship an unresolved or malformed release.
const htmlPath = new URL("../dist/index.html", import.meta.url);
const sourceHtml = await readFile(htmlPath, "utf8");
const release = sourceHtml.match(/<meta name="astra-release" content="([^"]+)">/)?.[1];
if (!release || !/^\d+\.\d+\.\d+$/.test(release)) {
  throw new Error("Build failed: astra-release must be a semantic version.");
}
const builtHtml = sourceHtml.replaceAll("__ASTRA_VERSION__", release);
if (builtHtml.includes("__ASTRA_VERSION__")) {
  throw new Error("Build failed: an Astra release placeholder was not resolved.");
}
await writeFile(htmlPath, builtHtml);

const builtFiles = await readdir(output);
if (!builtFiles.includes("index.html")) {
  throw new Error("Build failed: dist/index.html was not created.");
}

console.log(`Built ${join("dist")} with ${builtFiles.length} top-level entr${builtFiles.length === 1 ? "y" : "ies"}.`);
