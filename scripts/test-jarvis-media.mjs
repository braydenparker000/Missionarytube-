import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const release = JSON.parse(readFileSync(resolve(repoRoot, "jarvis-release.json"), "utf8"));
if (release.repository !== "braydenparker999/jarvis" || !/^[a-f0-9]{40}$/.test(release.commit || "")) {
  throw new Error("jarvis-release.json does not pin an exact braydenparker999/jarvis commit");
}

// Source-unit files keep every original assertion. On the pinned tree they
// still fail when a src module is missing, and that failure stays in this
// list so it cannot be read as a shipped-bundle result.
const SOURCE_TESTS = [
  "tests/app-wiring.test.mjs",
  "tests/appearance.test.mjs",
  "tests/audio-player.test.mjs",
  "tests/catalog-registry.test.mjs",
  "tests/collection-tools.test.mjs",
  "tests/compatibility-player.test.mjs",
  "tests/dependency-pinning.test.mjs",
  "tests/discovery-health.test.mjs",
  "tests/federated-search.test.mjs",
  "tests/initial-theme.test.mjs",
  "tests/interaction-motion.test.mjs",
  "tests/library-continuity.test.mjs",
  "tests/media-hub.test.mjs",
  "tests/playback-adapters.test.mjs",
  "tests/playback-delivery.test.mjs",
  "tests/playback-diagnostics.test.mjs",
  "tests/playback-engine.test.mjs",
  "tests/playback-episodes.test.mjs",
  "tests/playback-request-policy.test.mjs",
  "tests/playback-settings.test.mjs",
  "tests/playback-streams.test.mjs",
  "tests/playback-subtitles.test.mjs",
  "tests/playback-video-health.test.mjs",
  "tests/player-recovery.test.mjs",
  "tests/progress-store.test.mjs",
  "tests/redesign.test.mjs",
  "tests/route-runtime.test.mjs",
  "tests/search-intent.test.mjs",
  "tests/software-player.test.mjs",
  "tests/source-view.test.mjs",
  "tests/youtube-api.test.mjs",
  "tests/youtube-instances.test.mjs",
  "tests/youtube-piped.test.mjs",
  "tests/youtube-playback.test.mjs",
  "tests/youtube-wiring.test.mjs"
];

// Shipped-bundle files call the pinned public bundles only. Unsupported
// clauses are test.todo entries in those files, not omitted assertions.
const SHIPPED_TESTS = [
  "tests/jarvis-shipped-compatibility.suite.mjs",
  "tests/jarvis-shipped-motion.suite.mjs",
  "tests/jarvis-shipped-first-paint.suite.mjs"
];

const SUITES = { source: SOURCE_TESTS, shipped: SHIPPED_TESTS };
const suite = process.argv[2];
if (!SUITES[suite]) {
  // `npm test` discovers this file because the name matches test-*.mjs.
  // Inside that runner the explicit source and shipped scripts are not the
  // invocation, and a nested --test run is skipped by Node. Leave the root
  // suite green instead of treating a missing selector as a Jarvis failure.
  if (process.env.NODE_TEST_CONTEXT) process.exit(0);
  console.error("usage: node scripts/test-jarvis-media.mjs <source|shipped>");
  process.exit(2);
}

const source = mkdtempSync(resolve(tmpdir(), "jarvis-pinned-"));
let status = 1;
const origin = "https://github.com/braydenparker999/jarvis.git";

function git(args, cwd = source) {
  execFileSync("git", args, { cwd, stdio: "inherit" });
}

function captured(args) {
  return execFileSync("git", ["-C", source, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// Fresh clone of the pinned SHA. A reused .jarvis-source checkout is not
// evidence: qualification may have left it dirty, and HEAD equality alone
// does not prove the worktree is clean.
try {
  execFileSync("git", ["init", source], { stdio: "inherit" });
  git(["remote", "add", "origin", origin]);
  git(["fetch", "--depth", "1", "origin", release.commit]);
  git(["checkout", "--detach", "FETCH_HEAD"]);
  const head = captured(["rev-parse", "HEAD"]);
  const porcelain = execFileSync("git", ["-C", source, "status", "--porcelain"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  console.log(`$ git -C ${source} rev-parse HEAD`);
  console.log(head);
  console.log(`$ git -C ${source} status --porcelain`);
  console.log(porcelain.length ? porcelain : "<empty>");
  if (head !== release.commit) throw new Error(`Jarvis source ${head} is not the pinned release ${release.commit}`);
  if (porcelain !== "") throw new Error(`Pinned Jarvis checkout is not clean:\n${porcelain}`);
  console.log(`clean checkout verified: git status --porcelain empty at ${head}`);

  const media = resolve(source, "public/media");
  if (media === repoRoot) throw new Error("Pinned media path resolved to the repo-root copy");
  if (!existsSync(resolve(media, "index.html")) || !existsSync(resolve(media, "assets/js/app.js"))) {
    throw new Error("Pinned Jarvis checkout has no public/media app");
  }
  const tree = captured(["rev-parse", "HEAD:public/media"]);
  console.log(`Jarvis media source ${release.commit} public/media ${tree}`);
  status = runMediaTests(media);
} finally {
  rmSync(source, { recursive: true, force: true });
}
process.exit(status);

function runMediaTests(media) {
  console.log(`media suite: ${suite} (${SUITES[suite].length} files)`);
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...SUITES[suite]], {
    cwd: repoRoot,
    env: { ...process.env, MEDIA_APP_ROOT: media },
    stdio: "inherit"
  });
  return result.status ?? 1;
}
