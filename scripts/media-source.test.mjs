import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { checkedComponentSource, checkedMediaSource, readDailyBoardSource, readMediaSource } from "./media-source.mjs";

const root = process.cwd();
const source = JSON.parse(readFileSync(resolve(root, "jarvis-media-source.json"), "utf8"));
const dailyBoardSource = JSON.parse(readFileSync(resolve(root, "jarvis-dailyBoard-source.json"), "utf8"));

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
