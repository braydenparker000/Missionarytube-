import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SOURCE_ONLY_FILES,
  parsePending,
  scanTodos,
  sourceModulesPresent,
  sourceOnlyPattern,
  verdict
} from "./media-qualification.mjs";
import { readMediaSource } from "./media-source.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const release = JSON.parse(readFileSync(resolve(repoRoot, "jarvis-release.json"), "utf8"));
if (release.repository !== "braydenparker999/jarvis" || !/^[a-f0-9]{40}$/.test(release.commit || "")) {
  throw new Error("jarvis-release.json does not pin an exact braydenparker999/jarvis commit");
}
const mediaSource = readMediaSource(repoRoot);

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

const MODES = new Set(["source", "shipped", "pinned", "source-only", "qualify"]);
const mode = process.argv[2];
if (!MODES.has(mode)) {
  // `npm test` discovers this file because the name matches test-*.mjs.
  // Inside that runner the explicit scripts are not the invocation, and a
  // nested --test run is skipped by Node. Leave the root suite green instead
  // of treating a missing selector as a Jarvis failure.
  if (process.env.NODE_TEST_CONTEXT) process.exit(0);
  console.error("usage: node scripts/test-jarvis-media.mjs <source|shipped|pinned|source-only|qualify>");
  process.exit(2);
}

let status = 1;

function runNodeTest(files, { media = null, namePattern = "", skipPattern = "" } = {}) {
  const env = { ...process.env };
  if (media) env.MEDIA_APP_ROOT = media;
  else delete env.MEDIA_APP_ROOT;
  const args = ["--test", "--test-reporter=tap"];
  if (namePattern) args.push(`--test-name-pattern=${namePattern}`);
  if (skipPattern) args.push(`--test-skip-pattern=${skipPattern}`);
  args.push(...files);
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, env, stdio: "inherit" });
  return result.status ?? 1;
}

// The 29 names run against the tree that actually contains their src modules.
// The pin does not, so they use the repo-root copy. MEDIA_APP_ROOT is removed
// rather than pointed at the repo root, which the helper rejects.
function sourceOnlyEnv(media) {
  if (sourceModulesPresent(media)) return media;
  if (!sourceModulesPresent(repoRoot)) {
    throw new Error("source-only tests have no src/compatibility-player.js, src/interaction-logic.js, or src/astra-motion.js");
  }
  console.log("source-only modules are absent from the pinned public/media tree; running them where those sources exist");
  return null;
}

function qualificationVerdict(testsPass) {
  const pending = parsePending(readFileSync(resolve(repoRoot, "test-evidence/media-migration/pending-and-discrepancies.md"), "utf8"));
  const todos = scanTodos(resolve(repoRoot, "tests"));
  const result = verdict({ testsPass, pending, todos });
  console.log(`pending items: ${result.pendingCount === null ? "malformed" : result.pendingCount}`);
  console.log(`todos: ${result.todoCount}`);
  if (result.reasons.length) console.log(result.reasons.map((reason) => `- ${reason}`).join("\n"));
  console.log(`QUALIFICATION: ${result.status}`);
  return result.ready ? 0 : 1;
}

try {
  const media = mediaSource.directory;
  if (media === repoRoot) throw new Error("Jarvis media path resolved to the orchestration root");
  if (!readFileSync(resolve(media, "index.html"), "utf8") || !readFileSync(resolve(media, "assets/js/app.js"), "utf8")) {
    throw new Error("Exact destination commit has no Jarvis public/media app");
  }
  console.log(`Jarvis media ${mediaSource.repository}@${mediaSource.commit}:${mediaSource.path} ${mediaSource.tree}`);
  const pattern = sourceOnlyPattern();
  if (mode === "source") {
    console.log(`media suite: source (${SOURCE_TESTS.length} files)`);
    status = runNodeTest(SOURCE_TESTS, { media });
  } else if (mode === "shipped") {
    console.log(`media suite: shipped (${SHIPPED_TESTS.length} files)`);
    status = runNodeTest(SHIPPED_TESTS, { media });
  } else if (mode === "pinned") {
    console.log(`media suite: pinned (${SOURCE_TESTS.length} files, source-only names skipped)`);
    status = runNodeTest(SOURCE_TESTS, { media, skipPattern: pattern });
  } else if (mode === "source-only") {
    console.log(`media suite: source-only (${SOURCE_ONLY_FILES.length} files)`);
    status = runNodeTest(SOURCE_ONLY_FILES, { media: sourceOnlyEnv(media), namePattern: pattern });
  } else {
    console.log("=== pinned ===");
    const pinned = runNodeTest(SOURCE_TESTS, { media, skipPattern: pattern });
    console.log(`pinned exit ${pinned}`);
    console.log("=== source-only ===");
    const sourceOnly = runNodeTest(SOURCE_ONLY_FILES, { media: sourceOnlyEnv(media), namePattern: pattern });
    console.log(`source-only exit ${sourceOnly}`);
    console.log("=== shipped ===");
    const shipped = runNodeTest(SHIPPED_TESTS, { media });
    console.log(`shipped exit ${shipped}`);
    status = qualificationVerdict(pinned === 0 && sourceOnly === 0 && shipped === 0);
  }
} catch (error) {
  console.error(error.message);
  status = 1;
}
process.exit(status);
