import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const failures = [];
const requiredFiles = [
  "index.html",
  "assets/css/obsidian.css",
  "assets/js/app.js",
  "assets/js/progress-store.js",
  "assets/js/catalog-registry.js",
  "assets/js/discovery-health.js",
  "assets/js/federated-search.js",
  "assets/js/playback/settings.js",
  "assets/js/playback/streams.js",
  "assets/js/playback/adapters.js",
  "assets/js/playback/engine.js",
  "assets/js/playback/episodes.js",
  "assets/js/playback/subtitles.js",
  "assets/js/youtube/config.js",
  "assets/js/youtube/instances.js",
  "assets/js/youtube/api.js",
  "assets/js/youtube/playback.js",
  "AGENTS.md",
  "CLAUDE.md",
  "docs/WORKFLOW.md",
  "docs/AI-COLLABORATION.md",
  "docs/EVALUATION.md",
  "docs/AZURE-DEPLOYMENT.md",
  "evals/results/scoreboard.json"
];

for (const path of requiredFiles) {
  try {
    await access(path);
  } catch {
    failures.push(`Missing required file: ${path}`);
  }
}

const html = await readFile("index.html", "utf8");
const checks = [
  [/<!doctype html>/i, "index.html must declare an HTML doctype"],
  [/<html[^>]*lang=/i, "index.html must declare a document language"],
  [/<meta[^>]*name=["']viewport["']/i, "index.html must include a viewport meta tag"],
  [/<title>[^<]+<\/title>/i, "index.html must include a non-empty title"],
  [/<main(?:\s|>)/i, "index.html must include a main landmark"]
];

for (const [pattern, message] of checks) {
  if (!pattern.test(html)) failures.push(message);
}

for (const asset of html.matchAll(/(?:src|href)=["'](assets\/[^"'?#]+)/g)) {
  try {
    await access(asset[1]);
  } catch {
    failures.push(`Referenced asset does not exist: ${asset[1]}`);
  }
}

// Remote runtime dependencies must be reproducible: an exact version and a
// subresource integrity hash, never a mutable channel such as /latest/.
const MUTABLE_CHANNEL = /(?:\/|@)(?:latest|next|canary|edge|beta|dev|main|master)(?:\/|$)/i;
const PINNED_VERSION = /(?:@|\/v?)\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?(?:\/|$)/;
const SRI = "sha(?:256|384|512)-[A-Za-z0-9+/=_-]+";

async function collectSourceFiles(directory) {
  const found = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await collectSourceFiles(path)));
    else if (/\.(?:js|mjs|html)$/.test(entry.name)) found.push(path);
  }
  return found;
}

const sourceFiles = ["index.html", ...(await collectSourceFiles("assets"))];
let remoteDependencies = 0;

for (const path of sourceFiles) {
  const source = await readFile(path, "utf8");
  const protectedUrls = new Set([
    ...[...source.matchAll(new RegExp(`src:\\s*'(https://[^']+)'\\s*,\\s*integrity:\\s*'${SRI}'`, "g"))].map((m) => m[1]),
    ...[...source.matchAll(new RegExp(`src:\\s*"(https://[^"]+)"\\s*,\\s*integrity:\\s*"${SRI}"`, "g"))].map((m) => m[1]),
    ...[...source.matchAll(new RegExp(`<script[^>]+src=["'](https://[^"']+)["'][^>]*integrity=["']${SRI}["']`, "g"))].map((m) => m[1])
  ]);

  for (const match of source.matchAll(/https:\/\/[^\s'"`<>)]+\.m?js\b/g)) {
    const url = match[0];
    remoteDependencies += 1;
    if (MUTABLE_CHANNEL.test(url)) {
      failures.push(`${path} loads a mutable dependency channel, pin an exact version: ${url}`);
    } else if (!PINNED_VERSION.test(url)) {
      failures.push(`${path} loads a remote script without a pinned version: ${url}`);
    }
    if (!protectedUrls.has(url)) {
      failures.push(`${path} loads a remote script without a subresource integrity hash: ${url}`);
    }
  }
}

const scoreboard = JSON.parse(await readFile("evals/results/scoreboard.json", "utf8"));
if (scoreboard.schemaVersion !== 1 || !Array.isArray(scoreboard.results)) {
  failures.push("evals/results/scoreboard.json must use schemaVersion 1 and contain a results array");
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(
  `Validation passed (${requiredFiles.length} required files, ${checks.length} HTML checks, ` +
    `${remoteDependencies} pinned remote dependenc${remoteDependencies === 1 ? "y" : "ies"}).`
);
