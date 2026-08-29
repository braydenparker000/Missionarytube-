/**
 * Recompute the pinned player-library integrity hashes in index.html.
 *
 * The DASH and HLS runtimes are loaded from jsDelivr, which serves npm package
 * files byte for byte, so the subresource integrity hash can be derived from
 * the registry tarball. Run this (it needs network access) when bumping a
 * version, then commit the updated index.html:
 *
 *   node scripts/pin-player-libs.mjs
 *   node scripts/pin-player-libs.mjs --check   # verify without writing
 *
 * `npm test` deliberately does not run this: validation must stay offline and
 * deterministic. It only asserts that every remote script is version pinned
 * and integrity protected.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";

const LIBS = [
  { package: "dashjs", version: "5.2.0", file: "dist/modern/umd/dash.all.min.js" },
  { package: "hls.js", version: "1.6.13", file: "dist/hls.min.js" }
];

const checkOnly = process.argv.includes("--check");

async function tarballEntry(pkg, version, file) {
  const scope = pkg.startsWith("@") ? pkg.split("/")[1] : pkg;
  const url = `https://registry.npmjs.org/${pkg}/-/${scope}-${version}.tgz`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}`);

  // Extract a single member with the system tar to avoid a build dependency.
  const child = spawn("tar", ["-xzO", "-f", "-", `package/${file}`], { stdio: ["pipe", "pipe", "inherit"] });
  const chunks = [];
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  await pipeline(Readable.fromWeb(response.body), child.stdin);
  const code = await new Promise((resolve) => child.on("close", resolve));
  if (code !== 0) throw new Error(`tar failed extracting package/${file} from ${pkg}@${version}`);
  return Buffer.concat(chunks);
}

let html = await readFile("index.html", "utf8");
let changed = 0;

for (const lib of LIBS) {
  const bytes = await tarballEntry(lib.package, lib.version, lib.file);
  const integrity = `sha384-${createHash("sha384").update(bytes).digest("base64")}`;
  const src = `https://cdn.jsdelivr.net/npm/${lib.package}@${lib.version}/${lib.file}`;
  const pattern = new RegExp(`src:'${src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}',integrity:'(sha384-[^']+)'`);
  const match = html.match(pattern);

  if (!match) throw new Error(`index.html does not pin ${src}`);
  if (match[1] === integrity) {
    console.log(`ok    ${lib.package}@${lib.version} (${bytes.length} bytes) ${integrity}`);
    continue;
  }
  console.log(`stale ${lib.package}@${lib.version} expected ${integrity}, found ${match[1]}`);
  changed += 1;
  html = html.replace(pattern, `src:'${src}',integrity:'${integrity}'`);
}

if (!changed) process.exit(0);
if (checkOnly) {
  console.error(`${changed} integrity hash(es) are out of date.`);
  process.exit(1);
}
await writeFile("index.html", html);
console.log(`Updated ${changed} integrity hash(es) in index.html.`);
