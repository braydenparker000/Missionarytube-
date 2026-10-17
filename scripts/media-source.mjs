import { readFileSync, lstatSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

export const MEDIA_SOURCE_PATH = "jarvis/public/media";
export const MEDIA_SOURCE_REPOSITORY = "braydenparker000/Missionarytube-";
export const MEDIA_SOURCE_COMMIT = "7520eeaea05825ef8edafc5882ef4e053e99f26d";
export const MEDIA_SOURCE_TREE = "c4d89e4aab446f6f79b17b7df911ec3c3f59e4d7";

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

export function checkedMediaSource(source, { root = process.cwd(), head = git(resolve(root), "rev-parse", "HEAD") } = {}) {
  root = resolve(root);
  if (!source || source.repository !== MEDIA_SOURCE_REPOSITORY || source.commit !== MEDIA_SOURCE_COMMIT ||
      source.path !== MEDIA_SOURCE_PATH || source.tree !== MEDIA_SOURCE_TREE) {
    throw new Error("Invalid exact Jarvis media source identity");
  }
  let headTree;
  try {
    headTree = git(root, "rev-parse", `${head}:${source.path}`);
  } catch {
    throw new Error("Jarvis media source path is absent from destination history");
  }
  if (headTree !== source.tree) {
    throw new Error("Jarvis media source destination path does not match the qualified tree");
  }
  let commitTree = null;
  try { commitTree = git(root, "rev-parse", `${source.commit}:${source.path}`); }
  catch {
    if (git(root, "rev-parse", "--is-shallow-repository") !== "true") {
      throw new Error("Jarvis media source commit is absent from destination history");
    }
  }
  if (commitTree !== null) {
    if (commitTree !== source.tree) throw new Error("Jarvis media source commit does not contain the qualified tree");
    try { execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", source.commit, head], { stdio: "ignore" }); }
    catch { throw new Error("Jarvis media source commit is not an ancestor of the destination checkout"); }
  }
  const directory = resolve(root, source.path);
  try {
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error();
    execFileSync("git", ["-C", root, "diff", "--quiet", head, "--", source.path], { stdio: "ignore" });
    const untracked = git(root, "ls-files", "--others", "--exclude-standard", "--", source.path);
    if (untracked) throw new Error();
  } catch {
    throw new Error("Jarvis media source worktree differs from its exact destination commit");
  }
  return { ...source, directory };
}

export function readMediaSource(root = process.cwd()) {
  root = resolve(root);
  const source = JSON.parse(readFileSync(join(root, "jarvis-media-source.json"), "utf8"));
  return checkedMediaSource(source, { root });
}
