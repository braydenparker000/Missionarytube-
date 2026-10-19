import { readFileSync, lstatSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

export const COMPONENT_SOURCES = {
  activePublic: {
    repository: "braydenparker000/Missionarytube-",
    commit: "de5d7177a778f4bfa2aa071ab064a8a4fb9b2246",
    path: "jarvis-active-public-c28/public",
    tree: "67a47e36414a8ceb4040c9454f64ed1982a9146c"
  },
  media: {
    repository: "braydenparker000/Missionarytube-",
    commit: "bccda52d2c84bdfc2d315c7250cd9efbd8594aff",
    path: "jarvis/public/media",
    tree: "4a4aceb3661e437471a1d28f6574b9b21b28a343"
  },
  dailyBoard: {
    repository: "braydenparker000/Missionarytube-",
    commit: "1a8d13286571b32791d5d66d430ce38369708308",
    path: "jarvis/public/daily-board",
    tree: "52069a7390ead86792593bcff9d3fe7a9f07f187"
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
export const readActivePublicSource = (root = process.cwd()) => readComponentSource("activePublic", root);
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
