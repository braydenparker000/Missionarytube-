import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, resolve, dirname } from "node:path";

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Orchestration repo root, including explicit test-only legacy sources. */
export function repoRoot() {
  return REPO_ROOT;
}

/** Media tests always target public/media at the exact release pin. No fallback. */
const verifiedRoots = new Set();
export function mediaAppRoot() {
  const override = process.env.MEDIA_APP_ROOT;
  const resolved = resolve(REPO_ROOT, override || ".jarvis-source/public/media");
  if (resolved === resolve(REPO_ROOT)) {
    throw new Error("MEDIA_APP_ROOT resolved to the repo-root media copy. Jarvis-targeted tests must use the pinned checkout.");
  }
  if (!verifiedRoots.has(resolved)) {
    try {
      const release = JSON.parse(readFileSync(join(REPO_ROOT, "jarvis-release.json"), "utf8"));
      const checkout = dirname(dirname(resolved));
      const git = (...args) => execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      if (release.repository !== "braydenparker999/jarvis" || !/^[a-f0-9]{40}$/.test(release.commit || "") ||
          realpathSync(resolved) !== join(realpathSync(checkout), "public/media") ||
          realpathSync(git("rev-parse", "--show-toplevel")) !== realpathSync(checkout) ||
          git("rev-parse", "HEAD") !== release.commit) {
        throw new Error("checkout must be public/media at the exact jarvis-release.json pin");
      }
      readFileSync(join(resolved, "index.html"));
      verifiedRoots.add(resolved);
    } catch (cause) {
      throw new Error(`Pinned Jarvis media checkout required at ${resolved}; refusing root fallback. ${cause.message}`, { cause });
    }
  }
  return resolved;
}

/** Only these retained modules support the 29 legacy source-unit contracts.
 * Explicit pinned-source runs still expose missing source modules at the pin.
 */
export function legacySourcePath(relativePath) {
  if (!["src/compatibility-player.js", "src/interaction-logic.js", "src/astra-motion.js"].includes(relativePath)) {
    throw new Error(`Not a retained legacy source module: ${relativePath}`);
  }
  return process.env.MEDIA_APP_ROOT ? appPath(relativePath) : join(REPO_ROOT, relativePath);
}
export function legacySourceURL(relativePath) {
  return pathToFileURL(legacySourcePath(relativePath));
}

export function appPath(relativePath) {
  return join(mediaAppRoot(), relativePath);
}

export async function readAppSource(relativePath) {
  try {
    return await readFile(appPath(relativePath), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      const refusal = new Error(`Refusing to fall back to the repo-root copy for ${relativePath}. Jarvis-targeted tests require that file in the pinned checkout (${mediaAppRoot()}).`);
      refusal.code = "ERR_MEDIA_ROOT_FALLBACK";
      refusal.cause = error;
      throw refusal;
    }
    throw error;
  }
}

export function listAppDir(relativePath) {
  return readdir(appPath(relativePath));
}

/** file: URL for a dynamic import of a shipped media module. */
export function appFileURL(relativePath) {
  return pathToFileURL(appPath(relativePath));
}
