import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mediaAppRoot, readAppSource, repoRoot } from "./helpers/media-root.mjs";

test("unset MEDIA_APP_ROOT selects the exact destination Jarvis media path", async () => {
  assert.equal(process.env.MEDIA_APP_ROOT, undefined);
  assert.equal(mediaAppRoot(), new URL("../jarvis/public/media", import.meta.url).pathname);
  assert.equal(await readAppSource("index.html"), await readFile(new URL("../jarvis/public/media/index.html", import.meta.url), "utf8"));
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

test("retained source-only modules stay explicitly rooted at the orchestration checkout", async () => {
  const { legacySourcePath } = await import("./helpers/media-root.mjs");
  assert.equal(legacySourcePath("src/compatibility-player.js"), resolve(repoRoot(), "src/compatibility-player.js"));
});
