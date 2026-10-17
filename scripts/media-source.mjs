import { readFileSync, lstatSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

export const MEDIA_SOURCE_PATH = "jarvis/public/media";
export const MEDIA_SOURCE_REPOSITORY = "braydenparker000/Missionarytube-";

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

export function checkedMediaSource(source, { root = process.cwd(), head = git(resolve(root), "rev-parse", "HEAD") } = {}) {
  root = resolve(root);
  if (!source || source.repository !== MEDIA_SOURCE_REPOSITORY || !/^[a-f0-9]{40}$/.test(source.commit || "") ||
      source.path !== MEDIA_SOURCE_PATH || !/^[a-f0-9]{40}$/.test(source.tree || "")) {
    throw new Error("Invalid exact Jarvis media source identity");
  }
  let commitTree;
  let headTree;
  try {
    commitTree = git(root, "rev-parse", `${source.commit}:${source.path}`);
    headTree = git(root, "rev-parse", `${head}:${source.path}`);
    execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", source.commit, head], { stdio: "ignore" });
  } catch {
    throw new Error("Jarvis media source commit/path is not present in destination history");
  }
  if (commitTree !== source.tree || headTree !== source.tree) {
    throw new Error("Jarvis media source commit, path or tree does not match the qualified destination tree");
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
