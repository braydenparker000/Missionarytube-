import { cp, mkdir, readdir, rm } from "node:fs/promises";
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

const builtFiles = await readdir(output);
if (!builtFiles.includes("index.html")) {
  throw new Error("Build failed: dist/index.html was not created.");
}

console.log(`Built ${join("dist")} with ${builtFiles.length} top-level entr${builtFiles.length === 1 ? "y" : "ies"}.`);
