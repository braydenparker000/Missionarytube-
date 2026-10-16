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
 * path. scripts/test-jarvis-media.mjs sets MEDIA_APP_ROOT to the pinned
 * Jarvis checkout at .jarvis-source/public/media.
 */
export function mediaAppRoot() {
  const override = process.env.MEDIA_APP_ROOT;
  if (!override) return REPO_ROOT;
  return isAbsolute(override) ? override : resolve(REPO_ROOT, override);
}

export function appPath(relativePath) {
  return join(mediaAppRoot(), relativePath);
}

export function readAppSource(relativePath) {
  return readFile(appPath(relativePath), "utf8");
}

export function listAppDir(relativePath) {
  return readdir(appPath(relativePath));
}

/** file: URL for a dynamic import of a shipped media module. */
export function appFileURL(relativePath) {
  return pathToFileURL(appPath(relativePath));
}
