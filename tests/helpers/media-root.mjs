import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isAbsolute, join, resolve } from "node:path";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Orchestration repo root. The historical media copy still lives here. */
export function repoRoot() {
  return REPO_ROOT;
}

/**
 * Directory whose index.html and assets/ the media regression tests read.
 *
 * Unset MEDIA_APP_ROOT keeps the repo-root copy, so `npm test` stays on that
 * path. scripts/test-jarvis-media.mjs source|shipped sets MEDIA_APP_ROOT to a
 * clean checkout of the pinned Jarvis commit at public/media. A Jarvis target that resolves
 * to this repository is a failed run, never a silent fallback.
 */
export function mediaAppRoot() {
  const override = process.env.MEDIA_APP_ROOT;
  if (!override) return REPO_ROOT;
  const resolved = resolve(isAbsolute(override) ? override : resolve(REPO_ROOT, override));
  if (resolved === resolve(REPO_ROOT)) {
    throw new Error("MEDIA_APP_ROOT resolved to the repo-root media copy. Jarvis-targeted tests must use the pinned checkout.");
  }
  return resolved;
}

export function appPath(relativePath) {
  return join(mediaAppRoot(), relativePath);
}

export async function readAppSource(relativePath) {
  try {
    return await readFile(appPath(relativePath), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT" && process.env.MEDIA_APP_ROOT) {
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
