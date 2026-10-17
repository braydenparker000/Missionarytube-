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
  },
  connect: {
    repository: "braydenparker000/Missionarytube-",
    commit: "41383d9d5154aab3b1d7922d5e7c376376139c07",
    path: "jarvis/public/connect",
    tree: "14da00ba05225eddc0ad9d1717660c1f4b2e93c9"
  }
};

export const COMPONENT_GROUP_SOURCES = {
  routeData: {
    repository: "braydenparker000/Missionarytube-",
    commit: "2b29ab492af5a68bc49888cdb441fafdd38b5427",
    components: {
      content: { path: "jarvis/public/content", tree: "d3855220d2b412feee57054ee31d367806755eef" },
      portal: { path: "jarvis/public/portal", tree: "f77aad2ee6548e770164a3be447b006a6692a3d0" },
      quickAi: { path: "jarvis/public/quick-ai", tree: "b003bed5af0c7480f557531ec66f296a6851ca6d" },
      reader: { path: "jarvis/public/reader", tree: "3e13fa1f294299a11f16a062d9d6328ea1451ca9" },
      respond: { path: "jarvis/public/respond", tree: "14da00ba05225eddc0ad9d1717660c1f4b2e93c9" }
    }
  },
  appBundles: {
    repository: "braydenparker000/Missionarytube-",
    commit: "54fb839d4efa26af6d4162d65b00e4308dffe274",
    components: {
      mymedia: { path: "jarvis/public/mymedia", tree: "977932e1ef88d4701f187982d3f04c9906625b6d" },
      podcasts: { path: "jarvis/public/podcasts", tree: "d94f14ad0bc92c426d3111aae8aef0aaa9f49858" },
      youtubeArchive: { path: "jarvis/public/youtube-archive", tree: "3321453446d8013f8fda7610294b841fb1501f10" }
    }
  }
};

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function checkedPathSource(name, expected, source, { root, head }) {
  root = resolve(root);
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

export function checkedComponentSource(name, source, options = {}) {
  const root = resolve(options.root || process.cwd());
  const expected = COMPONENT_SOURCES[name];
  const head = options.head || git(root, "rev-parse", "HEAD");
  return checkedPathSource(name, expected, source, { ...options, root, head });
}

export function checkedComponentGroup(name, source, options = {}) {
  const root = resolve(options.root || process.cwd());
  const head = options.head || git(root, "rev-parse", "HEAD");
  const expected = COMPONENT_GROUP_SOURCES[name];
  const names = expected && Object.keys(expected.components);
  if (!expected || !source || source.repository !== expected.repository || source.commit !== expected.commit ||
      !source.components || Object.keys(source.components).length !== names.length ||
      names.some(component => !Object.hasOwn(source.components, component))) {
    throw new Error(`Invalid exact Jarvis ${name || "component"} source group identity`);
  }
  const components = Object.fromEntries(names.map(component => {
    const identity = { repository: expected.repository, commit: expected.commit, ...expected.components[component] };
    return [component, checkedPathSource(`${name} ${component}`, identity, {
      repository: source.repository,
      commit: source.commit,
      ...source.components[component]
    }, { ...options, root, head })];
  }));
  return { repository: source.repository, commit: source.commit, components };
}

export function readComponentSource(name, root = process.cwd()) {
  root = resolve(root);
  const source = JSON.parse(readFileSync(join(root, `jarvis-${name}-source.json`), "utf8"));
  return checkedComponentSource(name, source, { root });
}

export const readMediaSource = (root = process.cwd()) => readComponentSource("media", root);
export const readDailyBoardSource = (root = process.cwd()) => readComponentSource("dailyBoard", root);
export const readConnectSource = (root = process.cwd()) => readComponentSource("connect", root);
export const readRouteDataSource = (root = process.cwd()) => {
  root = resolve(root);
  const source = JSON.parse(readFileSync(join(root, "jarvis-routeData-source.json"), "utf8"));
  return checkedComponentGroup("routeData", source, { root });
};
export const readAppBundlesSource = (root = process.cwd()) => {
  root = resolve(root);
  const source = JSON.parse(readFileSync(join(root, "jarvis-appBundles-source.json"), "utf8"));
  return checkedComponentGroup("appBundles", source, { root });
};
export const checkedMediaSource = (source, options) => checkedComponentSource("media", source, options);
