import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const release = JSON.parse(readFileSync(resolve(repoRoot, "jarvis-release.json"), "utf8"));
if (release.repository !== "braydenparker999/jarvis" || !/^[a-f0-9]{40}$/.test(release.commit || "")) {
  throw new Error("jarvis-release.json does not pin an exact braydenparker999/jarvis commit");
}

const source = resolve(repoRoot, ".jarvis-source");
const origin = "https://github.com/braydenparker999/jarvis.git";

function git(args, cwd = source) {
  execFileSync("git", args, { cwd, stdio: "inherit" });
}

function head() {
  return execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// Qualification checks this same pin out to .jarvis-source before `npm test`
// (qualify-jarvis.yml). Reuse that checkout when it is already present.
if (!existsSync(resolve(source, ".git"))) {
  execFileSync("git", ["init", source], { stdio: "inherit" });
  git(["remote", "add", "origin", origin]);
}
let current = "";
try {
  current = head();
} catch {
  current = "";
}
if (current !== release.commit) {
  git(["fetch", "--depth", "1", "origin", release.commit]);
  git(["checkout", "--detach", "FETCH_HEAD"]);
}
if (head() !== release.commit) throw new Error("Jarvis source is not the pinned release commit");

const media = resolve(source, "public/media");
if (!existsSync(resolve(media, "index.html")) || !existsSync(resolve(media, "assets/js/app.js"))) {
  throw new Error("Pinned Jarvis checkout has no public/media app");
}
const tree = execFileSync("git", ["-C", source, "rev-parse", "HEAD:public/media"], { encoding: "utf8" }).trim();
console.log(`Jarvis media source ${release.commit} public/media ${tree}`);

// The 33 tests that read the repo-root media copy, plus playback-diagnostics,
// which reads assets/js/playback/*.js through a template the dependency map missed.
const tests = [
  "tests/app-wiring.test.mjs",
  "tests/appearance.test.mjs",
  "tests/audio-player.test.mjs",
  "tests/catalog-registry.test.mjs",
  "tests/collection-tools.test.mjs",
  "tests/compatibility-player.test.mjs",
  "tests/dependency-pinning.test.mjs",
  "tests/discovery-health.test.mjs",
  "tests/federated-search.test.mjs",
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

const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...tests], {
  cwd: repoRoot,
  env: { ...process.env, MEDIA_APP_ROOT: media },
  stdio: "inherit"
});
process.exit(result.status ?? 1);
