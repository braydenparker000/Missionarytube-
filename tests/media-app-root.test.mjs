import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { mediaAppRoot, readAppSource, repoRoot } from "./helpers/media-root.mjs";

test("unset MEDIA_APP_ROOT targets the pinned Jarvis media checkout", async () => {
  assert.equal(process.env.MEDIA_APP_ROOT, undefined);
  assert.equal(mediaAppRoot(), new URL("../.jarvis-source/public/media", import.meta.url).pathname);
  assert.equal(await readAppSource("index.html"), await readFile(new URL("../.jarvis-source/public/media/index.html", import.meta.url), "utf8"));
});

test("a Jarvis target cannot resolve to the repo-root copy", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { mediaAppRoot } from "./tests/helpers/media-root.mjs";
    process.env.MEDIA_APP_ROOT = ${JSON.stringify(repoRoot())};
    mediaAppRoot();
  `], { cwd: repoRoot(), encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /repo-root media copy/);
});

test("missing pinned media checkout fails closed", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { mediaAppRoot } from "./tests/helpers/media-root.mjs";
    process.env.MEDIA_APP_ROOT = ".missing-jarvis-checkout/public/media";
    mediaAppRoot();
  `], { cwd: repoRoot(), encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Pinned Jarvis media checkout required.*refusing root fallback/);
});

test("a checkout at a different release pin fails closed", async () => {
  const { mkdtemp, mkdir, cp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "media-wrong-pin-"));
  try {
    await mkdir(join(directory, "tests/helpers"), { recursive: true });
    await cp(new URL("./helpers/media-root.mjs", import.meta.url), join(directory, "tests/helpers/media-root.mjs"));
    await writeFile(join(directory, "jarvis-release.json"), JSON.stringify({ repository: "braydenparker999/jarvis", commit: "f".repeat(40) }));
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { mediaAppRoot } from "./tests/helpers/media-root.mjs";
      mediaAppRoot();
    `], { cwd: directory, env: { ...process.env, MEDIA_APP_ROOT: mediaAppRoot() }, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exact jarvis-release.json pin/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
