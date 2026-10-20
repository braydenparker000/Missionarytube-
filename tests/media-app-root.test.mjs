import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mediaAppRoot, readAppSource, repoRoot } from "./helpers/media-root.mjs";

test("unset MEDIA_APP_ROOT selects the authoritative editable frontend media path", async () => {
  assert.equal(process.env.MEDIA_APP_ROOT, undefined);
  assert.equal(mediaAppRoot(), new URL("../frontend/media", import.meta.url).pathname);
  assert.equal(await readAppSource("index.html"), await readFile(new URL("../frontend/media/index.html", import.meta.url), "utf8"));
});

test("a Jarvis target cannot resolve to the repo-root copy", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { mediaAppRoot } from "./tests/helpers/media-root.mjs";
    process.env.MEDIA_APP_ROOT = ${JSON.stringify(repoRoot())};
    mediaAppRoot();
  `], { cwd: repoRoot(), encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /exact Jarvis media source/);
});

test("source-only fixtures come from immutable history, outside the editable checkout", async () => {
  const { legacySourcePath } = await import("./helpers/media-root.mjs");
  assert.ok(!legacySourcePath("src/compatibility-player.js").startsWith(repoRoot()));
  assert.match(await readFile(legacySourcePath("src/compatibility-player.js"), "utf8"), /export/);
});
