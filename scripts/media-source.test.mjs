import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkedMediaSource, readMediaSource } from "./media-source.mjs";

const root = process.cwd();
const source = JSON.parse(readFileSync(resolve(root, "jarvis-media-source.json"), "utf8"));

test("media source resolves only the pinned destination commit, path and tree", () => {
  const checked = readMediaSource(root);
  assert.equal(checked.repository, "braydenparker000/Missionarytube-");
  assert.equal(checked.commit, "7520eeaea05825ef8edafc5882ef4e053e99f26d");
  assert.equal(checked.path, "jarvis/public/media");
  assert.equal(checked.tree, "c4d89e4aab446f6f79b17b7df911ec3c3f59e4d7");
  assert.equal(checked.directory, resolve(root, "jarvis/public/media"));
});

test("media source rejects an incorrect commit, path or subtree identity", () => {
  assert.throws(() => checkedMediaSource({ ...source, commit: "f".repeat(40) }, { root }), /commit\/path is not present/);
  assert.throws(() => checkedMediaSource({ ...source, path: "public/media" }, { root }), /Invalid exact Jarvis media source identity/);
  assert.throws(() => checkedMediaSource({ ...source, tree: "e".repeat(40) }, { root }), /commit, path or tree/);
});
