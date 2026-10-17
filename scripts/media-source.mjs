import { readFileSync, lstatSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

export const COMPONENT_SOURCES = {
  media: {
    repository: "braydenparker000/Missionarytube-",
    commit: "7520eeaea05825ef8edafc5882ef4e053e99f26d",
    path: "jarvis/public/media",
    tree: "c4d89e4aab446f6f79b17b7df911ec3c3f59e4d7"
  },
  dailyBoard: {
    repository: "braydenparker000/Missionarytube-",
    commit: "8201af9d10b6c0731f55c2b297b070b7922968d3",
    path: "jarvis/public/daily-board",
    tree: "b3214e6e8731cc0f3146d79a467c7c48710c3620"
  }
};

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

export function checkedComponentSource(name, source, { root = process.cwd(), head = git(resolve(root), "rev-parse", "HEAD") } = {}) {
  root = resolve(root);
  const expected = COMPONENT_SOURCES[name];
  if (!expected || !source || Object.keys(expected).some(key => source[key] !== expected[key])) {
    throw new Error(`Invalid exact Jarvis ${name || "component"} source identity`);
  }
  let headTree;
  try {
    headTree = git(root, "rev-parse", `${head}:${source.path}`);
  } catch {
    throw new Error(`Jarvis ${name} source path is absent from destination history`);
  }
  if (headTree !== source.tree) {
    throw new Error(`Jarvis ${name} source destination path does not match the qualified tree`);
  }
  let commitTree = null;
  try { commitTree = git(root, "rev-parse", `${source.commit}:${source.path}`); }
  catch {
    if (git(root, "rev-parse", "--is-shallow-repository") !== "true") {
      throw new Error(`Jarvis ${name} source commit is absent from destination history`);
    }
  }
  if (commitTree !== null) {
    if (commitTree !== source.tree) throw new Error(`Jarvis ${name} source commit does not contain the qualified tree`);
    try { execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", source.commit, head], { stdio: "ignore" }); }
    catch { throw new Error(`Jarvis ${name} source commit is not an ancestor of the destination checkout`); }
  }
  const directory = resolve(root, source.path);
  try {
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error();
    execFileSync("git", ["-C", root, "diff", "--quiet", head, "--", source.path], { stdio: "ignore" });
    const untracked = git(root, "ls-files", "--others", "--exclude-standard", "--", source.path);
    if (untracked) throw new Error();
  } catch {
    throw new Error(`Jarvis ${name} source worktree differs from its exact destination commit`);
  }
  return { ...source, directory };
}

export function readComponentSource(name, root = process.cwd()) {
  root = resolve(root);
  const source = JSON.parse(readFileSync(join(root, `jarvis-${name}-source.json`), "utf8"));
  return checkedComponentSource(name, source, { root });
}

export const readMediaSource = (root = process.cwd()) => readComponentSource("media", root);
export const readDailyBoardSource = (root = process.cwd()) => readComponentSource("dailyBoard", root);
export const checkedMediaSource = (source, options) => checkedComponentSource("media", source, options);
