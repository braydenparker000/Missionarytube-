import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isAbsolute, join, resolve } from "node:path";
import { readMediaSource } from "../../scripts/media-source.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LEGACY_SOURCES = new Set([
  "src/compatibility-player.js",
  "src/interaction-logic.js",
  "src/astra-motion.js"
]);

export function repoRoot() {
  return REPO_ROOT;
}

/** Media tests use the exact destination commit/path/tree recorded in the source manifest. */
export function mediaAppRoot() {
  const source = readMediaSource(REPO_ROOT);
  const override = process.env.MEDIA_APP_ROOT;
  if (override) {
    const requested = resolve(isAbsolute(override) ? override : resolve(REPO_ROOT, override));
    if (requested !== source.directory) {
      throw new Error(`MEDIA_APP_ROOT must resolve to the exact Jarvis media source (${source.directory})`);
    }
  }
  return source.directory;
}

/** Three retained root modules keep source-only legacy assertions runnable. */
export function legacySourcePath(relativePath) {
  if (!LEGACY_SOURCES.has(relativePath)) throw new Error(`Not a retained legacy source module: ${relativePath}`);
  if (process.env.MEDIA_APP_ROOT) return join(mediaAppRoot(), relativePath);
  return join(REPO_ROOT, relativePath);
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
      const refusal = new Error(`Required Jarvis media source file is absent: ${relativePath}`);
      refusal.code = "ERR_MEDIA_SOURCE_MISSING";
      refusal.cause = error;
      throw refusal;
    }
    throw error;
  }
}

export function listAppDir(relativePath) {
  return readdir(appPath(relativePath));
}

export function appFileURL(relativePath) {
  return pathToFileURL(appPath(relativePath));
}
