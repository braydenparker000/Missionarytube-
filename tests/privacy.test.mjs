import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * The repository is public. These checks fail the build if a configured add-on
 * URL, credential, or personal stream URL is ever committed.
 */

const SKIP_DIRS = new Set([".git", "node_modules", "dist", ".github"]);
const TEXT = /\.(?:js|mjs|cjs|html|css|json|md|yml|yaml)$/;

async function sourceFiles(directory = ".") {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(path)));
    else if (TEXT.test(entry.name)) found.push(path);
  }
  return found;
}

const files = await sourceFiles();
const contents = new Map();
for (const path of files) contents.set(path, await readFile(path, "utf8"));

/** Hosts the app is allowed to reference, with why each is acceptable. */
const ALLOWED_HOSTS = [
  "v3-cinemeta.strem.io", // the public default add-on, no configuration or token
  "cdn.jsdelivr.net", // pinned, integrity-checked player runtimes
  "registry.npmjs.org", // used by the dependency pinning script
  "www.youtube-nocookie.com", // privacy-preserving YouTube embed
  "github.com",
  "claude.ai",
  "code.claude.com",
  "raw.githubusercontent.com",
  "avatars.githubusercontent.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "gsap.com", // license notices embedded in the pinned self-hosted motion bundle
  "schema.org",
  "json-schema.org",
  "www.w3.org",
  "developer.mozilla.org",
  "creativecommons.org",
  "missionarytube.z13.web.core.windows.net", // the owner's own public site URL
  "cdn.dashjs.org" // negative fixture only: proves validation rejects the mutable /latest/ URL
];

function isAllowed(host) {
  if (ALLOWED_HOSTS.includes(host)) return true;
  // Reserved documentation/test names can never resolve to a real service.
  return /(?:^|\.)(?:example\.(?:test|com|org|net)|test|invalid|localhost)$/.test(host);
}

test("no committed file references a non-allowlisted external host", () => {
  const offenders = [];
  for (const [path, source] of contents) {
    for (const match of source.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?/gi)) {
      const host = match[1].toLowerCase();
      if (!isAllowed(host)) offenders.push(`${path}: ${host}`);
    }
  }
  assert.deepEqual(offenders, [], "an unexpected host may be a configured add-on or personal stream URL");
});

test("no committed file contains a Stremio-style configured manifest path", () => {
  // A configured AIOStreams/Comet manifest carries its token in the path.
  const configured = /https?:\/\/[^\s"'`]*\/[A-Za-z0-9_=-]{24,}\/manifest\.json/g;
  const offenders = [];
  for (const [path, source] of contents) {
    for (const match of source.matchAll(configured)) offenders.push(`${path}: ${match[0].slice(0, 60)}…`);
  }
  assert.deepEqual(offenders, []);
});

test("no committed file contains credential-shaped values", () => {
  const patterns = [
    [/\bAccountKey\s*=/i, "Azure storage account key"],
    [/\bDefaultEndpointsProtocol\s*=/i, "Azure connection string"],
    [/\bsig=[A-Za-z0-9%+/=]{20,}/, "SAS signature"],
    [/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[:=]\s*["'][^"']{12,}["']/i, "credential literal"],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
    [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, "JWT"],
    [/\brealdebrid|\balldebrid|\bpremiumize|\btorbox\b.{0,40}[:=]\s*["'][^"']{12,}/i, "debrid credential"]
  ];

  const offenders = [];
  for (const [path, source] of contents) {
    for (const [pattern, label] of patterns) {
      if (pattern.test(source)) offenders.push(`${path}: ${label}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("test fixtures use only reserved, non-resolvable hosts", async () => {
  const fixtureFiles = files.filter((path) => path.includes("fixtures"));
  assert.ok(fixtureFiles.length > 0, "there are fixtures to check");

  for (const path of fixtureFiles) {
    for (const match of contents.get(path).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = match[1].toLowerCase();
      assert.match(
        host,
        /(?:^|\.)(?:example\.(?:test|com|org|net)|test|invalid|localhost)$/,
        `${path} references ${host}, which is not a reserved test name`
      );
    }
  }
});

test("no fixture carries a plausible real infohash or token", () => {
  for (const path of files.filter((file) => file.includes("fixtures"))) {
    const source = contents.get(path);
    for (const match of source.matchAll(/\b[0-9a-f]{40}\b/gi)) {
      assert.match(
        match[0],
        /^(.)\1{39}$/i,
        `${path} contains ${match[0]}, which looks like a real infohash`
      );
    }
  }
});
