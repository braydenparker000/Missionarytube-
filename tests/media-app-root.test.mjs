import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mediaAppRoot, readAppSource, repoRoot } from "./helpers/media-root.mjs";

test("unset MEDIA_APP_ROOT keeps media regression on the repo-root copy", async () => {
  assert.equal(process.env.MEDIA_APP_ROOT, undefined);
  assert.equal(mediaAppRoot(), repoRoot());
  assert.equal(await readAppSource("index.html"), await readFile(new URL("../index.html", import.meta.url), "utf8"));
});
