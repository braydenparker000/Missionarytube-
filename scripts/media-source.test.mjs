import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { checkedComponentGroup, checkedComponentSource, checkedMediaSource, readAppBundlesSource, readConnectSource, readDailyBoardSource, readMediaSource, readRouteDataSource } from "./media-source.mjs";

const root = process.cwd();
const source = JSON.parse(readFileSync(resolve(root, "jarvis-media-source.json"), "utf8"));
const dailyBoardSource = JSON.parse(readFileSync(resolve(root, "jarvis-dailyBoard-source.json"), "utf8"));
const connectSource = JSON.parse(readFileSync(resolve(root, "jarvis-connect-source.json"), "utf8"));
const routeDataSource = JSON.parse(readFileSync(resolve(root, "jarvis-routeData-source.json"), "utf8"));
const appBundlesSource = JSON.parse(readFileSync(resolve(root, "jarvis-appBundles-source.json"), "utf8"));

test("media source resolves only the pinned destination commit, path and tree", () => {
  const checked = readMediaSource(root);
  assert.equal(checked.repository, "braydenparker000/Missionarytube-");
  assert.equal(checked.commit, "7520eeaea05825ef8edafc5882ef4e053e99f26d");
  assert.equal(checked.path, "jarvis/public/media");
  assert.equal(checked.tree, "c4d89e4aab446f6f79b17b7df911ec3c3f59e4d7");
  assert.equal(checked.directory, resolve(root, "jarvis/public/media"));
});

test("media source rejects an incorrect commit, path or subtree identity", () => {
  assert.throws(() => checkedMediaSource({ ...source, commit: "f".repeat(40) }, { root }), /Invalid exact Jarvis media source identity/);
  assert.throws(() => checkedMediaSource({ ...source, path: "public/media" }, { root }), /Invalid exact Jarvis media source identity/);
  assert.throws(() => checkedMediaSource({ ...source, tree: "e".repeat(40) }, { root }), /Invalid exact Jarvis media source identity/);
});

test("daily-board source resolves its exact destination commit, path and tree", () => {
  const checked = readDailyBoardSource(root);
  assert.equal(checked.repository, "braydenparker000/Missionarytube-");
  assert.equal(checked.commit, "8201af9d10b6c0731f55c2b297b070b7922968d3");
  assert.equal(checked.path, "jarvis/public/daily-board");
  assert.equal(checked.tree, "b3214e6e8731cc0f3146d79a467c7c48710c3620");
  assert.equal(checked.directory, resolve(root, "jarvis/public/daily-board"));
});

test("daily-board source rejects an incorrect destination commit, path or tree", () => {
  assert.throws(() => checkedComponentSource("dailyBoard", { ...dailyBoardSource, commit: "f".repeat(40) }, { root }), /Invalid exact Jarvis dailyBoard source identity/);
  assert.throws(() => checkedComponentSource("dailyBoard", { ...dailyBoardSource, path: "public/daily-board" }, { root }), /Invalid exact Jarvis dailyBoard source identity/);
  assert.throws(() => checkedComponentSource("dailyBoard", { ...dailyBoardSource, tree: "e".repeat(40) }, { root }), /Invalid exact Jarvis dailyBoard source identity/);
});

test("connect source resolves its exact destination commit, path and tree", () => {
  const checked = readConnectSource(root);
  assert.equal(checked.repository, "braydenparker000/Missionarytube-");
  assert.equal(checked.commit, "41383d9d5154aab3b1d7922d5e7c376376139c07");
  assert.equal(checked.path, "jarvis/public/connect");
  assert.equal(checked.tree, "14da00ba05225eddc0ad9d1717660c1f4b2e93c9");
  assert.equal(checked.directory, resolve(root, "jarvis/public/connect"));
});

test("connect source rejects an incorrect destination commit, path or tree", () => {
  assert.throws(() => checkedComponentSource("connect", { ...connectSource, commit: "f".repeat(40) }, { root }), /Invalid exact Jarvis connect source identity/);
  assert.throws(() => checkedComponentSource("connect", { ...connectSource, path: "public/connect" }, { root }), /Invalid exact Jarvis connect source identity/);
  assert.throws(() => checkedComponentSource("connect", { ...connectSource, tree: "e".repeat(40) }, { root }), /Invalid exact Jarvis connect source identity/);
});

test("unchanged route and data sources resolve as one exact destination group", () => {
  const checked = readRouteDataSource(root);
  assert.equal(checked.repository, "braydenparker000/Missionarytube-");
  assert.equal(checked.commit, "2b29ab492af5a68bc49888cdb441fafdd38b5427");
  assert.deepEqual(Object.keys(checked.components), ["content", "portal", "quickAi", "reader", "respond"]);
  for (const [name, component] of Object.entries(checked.components)) {
    assert.equal(component.directory, resolve(root, component.path));
    assert.equal(component.tree, routeDataSource.components[name].tree);
  }
});

test("route and data source group rejects changed pins and incomplete or altered paths", () => {
  assert.throws(() => checkedComponentGroup("routeData", { ...routeDataSource, commit: "f".repeat(40) }, { root }), /Invalid exact Jarvis routeData source group identity/);
  assert.throws(() => checkedComponentGroup("routeData", { ...routeDataSource, components: { ...routeDataSource.components, portal: { ...routeDataSource.components.portal, path: "public/portal" } } }, { root }), /Invalid exact Jarvis routeData portal source identity/);
  assert.throws(() => checkedComponentGroup("routeData", { ...routeDataSource, components: { ...routeDataSource.components, reader: { ...routeDataSource.components.reader, tree: "e".repeat(40) } } }, { root }), /Invalid exact Jarvis routeData reader source identity/);
  const { respond, ...missing } = routeDataSource.components;
  assert.throws(() => checkedComponentGroup("routeData", { ...routeDataSource, components: missing }, { root }), /Invalid exact Jarvis routeData source group identity/);
});

test("unchanged app bundles resolve as one exact destination group", () => {
  const checked = readAppBundlesSource(root);
  assert.equal(checked.repository, "braydenparker000/Missionarytube-");
  assert.equal(checked.commit, "54fb839d4efa26af6d4162d65b00e4308dffe274");
  assert.deepEqual(Object.keys(checked.components), ["mymedia", "podcasts", "youtubeArchive"]);
  for (const [name, component] of Object.entries(checked.components)) {
    assert.equal(component.directory, resolve(root, component.path));
    assert.equal(component.tree, appBundlesSource.components[name].tree);
  }
});

test("bundled-app local dependencies retain their exact source and destination blobs or trees", () => {
  const pin = JSON.parse(readFileSync(resolve(root, "jarvis-release.json"), "utf8")).commit;
  const dependencies = {
    "assets/ui.js": "0f0139ab3c6a624cea6c4389b833a94d8f0e620f",
    "assets/pip-diagnostics.js": "f4e180dbecda4622e4d1d0908e5e4d77449a94a2",
    "assets/drive-config.json": "5fd6ad18637a0bae5d9be2b07393fcfaf4809849",
    "assets/shell.css": "e5bfdd927649d966112c74308f0aa33d0f9cdac9",
    "assets/premium.css": "3bfde4418d4e46a909a799aacdd3555f92ce49b2",
    "assets/aligned-pages.css": "398860eca93460e65f39f559d617e252b09b584f",
    "assets/config.js": "721835805b3894e5007f1e519ca17b0671a0e6d5",
    "drawercast/drive-api.js": "10f6b93322ea843c598bfe6f08782fd45b78eb1b",
    "media/assets/js/playback": "4c8aa01a67f443c4dd5cc02e7fb6770cc9e15f10"
  };
  for (const [path, tree] of Object.entries(dependencies)) {
    const sourceTree = execFileSync("git", ["-C", resolve(root, ".jarvis-source"), "rev-parse", `${pin}:public/${path}`], { encoding: "utf8" }).trim();
    const destinationTree = execFileSync("git", ["-C", root, "rev-parse", `HEAD:jarvis/public/${path}`], { encoding: "utf8" }).trim();
    assert.equal(sourceTree, tree, `pinned dependency ${path}`);
    assert.equal(destinationTree, tree, `destination dependency ${path}`);
  }
});

test("the exact reviewed source remains usable in a shallow destination checkout", () => {
  const shallow = mkdtempSync(resolve(tmpdir(), "jarvis-media-shallow-"));
  const run = (...args) => execFileSync("git", ["-C", shallow, ...args], { stdio: "ignore" });
  try {
    run("init");
    const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    run("fetch", "--depth=1", root, head);
    run("checkout", "--detach", "FETCH_HEAD");
    assert.equal(execFileSync("git", ["-C", shallow, "rev-parse", "--is-shallow-repository"], { encoding: "utf8" }).trim(), "true");
    const checked = readMediaSource(shallow);
    assert.equal(checked.tree, source.tree);
    assert.equal(checked.directory, resolve(shallow, source.path));
  } finally {
    rmSync(shallow, { recursive: true, force: true });
  }
});
