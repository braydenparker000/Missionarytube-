import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const html = await readFile("index.html", "utf8");

const MUTABLE = /(?:\/|@)(?:latest|next|canary|edge|beta|dev|main|master)(?:\/|$)/i;

function remoteScripts(source) {
  return [...source.matchAll(/https:\/\/[^\s'"`<>)]+\.m?js\b/g)].map((match) => match[0]);
}

test("no runtime dependency is loaded from a mutable channel", () => {
  const mutable = remoteScripts(html).filter((url) => MUTABLE.test(url));
  assert.deepEqual(mutable, [], "every remote script must name an exact version");
  assert.equal(html.includes("cdn.dashjs.org/latest"), false);
});

test("dash.js is pinned to an exact version with an integrity hash", () => {
  const match = html.match(
    /src:'(https:\/\/cdn\.jsdelivr\.net\/npm\/dashjs@(\d+\.\d+\.\d+)\/[^']+\.js)',integrity:'(sha384-[A-Za-z0-9+/=]+)'/
  );
  assert.ok(match, "dash.js must be loaded from a pinned URL with an integrity hash");
  assert.equal(match[2], "5.2.0");
  assert.equal(match[3], "sha384-DUqWPzOl/i7/DGF7SBoe4NrlZOMxxomlJsg3X0daS5SBeFxco3dmwWQPFr2oauXn");
});

test("hls.js is pinned to an exact version with an integrity hash", () => {
  const match = html.match(
    /src:'(https:\/\/cdn\.jsdelivr\.net\/npm\/hls\.js@(\d+\.\d+\.\d+)\/[^']+\.js)',integrity:'(sha384-[A-Za-z0-9+/=]+)'/
  );
  assert.ok(match, "hls.js must be loaded from a pinned URL with an integrity hash");
  assert.equal(match[2], "1.6.13");
  assert.equal(match[3], "sha384-z+tuLqMWl1/cPv7O+39RO0EURSNvorimpcCaMgeNwU+qFBx+AlUIl7jaAwg0cYil");
});

test("every remote script is cross-origin and integrity checked at load time", () => {
  assert.match(html, /x\.integrity=lib\.integrity/);
  assert.match(html, /x\.crossOrigin='anonymous'/);
  assert.equal(remoteScripts(html).length, 2, "only the two player libraries are loaded remotely");
});

async function checkFixture(mutate) {
  const directory = await mkdtemp(join(tmpdir(), "missionarytube-check-"));
  try {
    await cp(process.cwd(), directory, {
      recursive: true,
      filter: (source) => !/(?:^|\/)(?:\.git|dist|node_modules)$/.test(source)
    });
    await mutate(directory);
    try {
      const { stdout } = await run(process.execPath, ["scripts/check.mjs"], { cwd: directory });
      return { code: 0, output: stdout };
    } catch (error) {
      return { code: error.code ?? 1, output: `${error.stdout || ""}${error.stderr || ""}` };
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("validation passes on an unmodified checkout", async () => {
  const result = await checkFixture(async () => {});
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Validation passed/);
});

test("validation rejects a mutable /latest/ dependency URL", async () => {
  const result = await checkFixture(async (directory) => {
    const path = join(directory, "index.html");
    const source = await readFile(path, "utf8");
    await writeFile(
      path,
      source.replace(
        /https:\/\/cdn\.jsdelivr\.net\/npm\/dashjs@[^']+/,
        "https://cdn.dashjs.org/latest/dash.all.min.js"
      )
    );
  });

  assert.equal(result.code, 1, "check.mjs must fail the build");
  assert.match(result.output, /mutable dependency channel/);
});

test("validation rejects a remote script without an integrity hash", async () => {
  const result = await checkFixture(async (directory) => {
    const path = join(directory, "index.html");
    const source = await readFile(path, "utf8");
    await writeFile(path, source.replace(/,integrity:'sha384-[^']+'/, ""));
  });

  assert.equal(result.code, 1, "check.mjs must fail the build");
  assert.match(result.output, /without a subresource integrity hash/);
});

test("validation requires the progress store module to ship", async () => {
  const result = await checkFixture(async (directory) => {
    await rm(join(directory, "assets/js/progress-store.js"));
  });

  assert.equal(result.code, 1);
  assert.match(result.output, /Missing required file: assets\/js\/progress-store\.js/);
});
