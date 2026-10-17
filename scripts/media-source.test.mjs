import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { checkedComponentGroup, checkedComponentSource, checkedMediaSource, readConnectSource, readDailyBoardSource, readMediaSource, readRouteDataSource } from "./media-source.mjs";

const root = process.cwd();
const source = JSON.parse(readFileSync(resolve(root, "jarvis-media-source.json"), "utf8"));
const dailyBoardSource = JSON.parse(readFileSync(resolve(root, "jarvis-dailyBoard-source.json"), "utf8"));
const connectSource = JSON.parse(readFileSync(resolve(root, "jarvis-connect-source.json"), "utf8"));
const routeDataSource = JSON.parse(readFileSync(resolve(root, "jarvis-routeData-source.json"), "utf8"));

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
