import test from "node:test";
import assert from "node:assert/strict";
import { assetIndex, scriptMode, scriptRunsBefore, stylesheetIndex, findScript } from "./helpers/shell-assets.mjs";

const shell = `
<link rel="preload" href="assets/js/app.js?v=1" as="script">
<link rel="stylesheet" href="assets/css/obsidian.css?v=1">
<script defer src="assets/js/progress-store.js?v=1"></script>
<script async defer src="assets/js/async-both.js?v=1"></script>
<script async src="assets/js/async-only.js?v=1"></script>
<script src="assets/js/blocking.js?v=1"></script>
<script defer src="assets/js/app.js?v=1"></script>
`;

test("script order ignores preload links and models parser-blocking, deferred, and async modes", () => {
  assert.equal(findScript(shell, "assets/js/app.js").index > stylesheetIndex(shell, "assets/css/obsidian.css"), true);
  assert.equal(assetIndex(shell, "assets/js/app.js") > assetIndex(shell, "assets/js/progress-store.js"), true);
  assert.equal(scriptRunsBefore(shell, "assets/js/progress-store.js", "assets/js/app.js"), true, "two deferred scripts keep document order");
  assert.equal(assetIndex(shell, "assets/js/async-only.js"), -1, "an async script is not an ordered load");
  assert.equal(scriptMode(findScript(shell, "assets/js/async-both.js")), "async", "async wins when a tag also sets defer");
  assert.equal(scriptRunsBefore(shell, "assets/js/async-only.js", "assets/js/app.js"), false);
  assert.equal(scriptRunsBefore(shell, "assets/js/progress-store.js", "assets/js/blocking.js"), false, "a deferred script does not run before a parser-blocking script");
  assert.equal(scriptRunsBefore(shell, "assets/js/blocking.js", "assets/js/app.js"), true, "parser-blocking scripts run before deferred scripts");
  assert.equal(assetIndex(shell, "assets/css/obsidian.css"), -1, "a stylesheet link is not a script");
  assert.ok(stylesheetIndex(shell, "assets/css/obsidian.css") > -1);
  const preloadOnly = `<link rel="preload" href="assets/js/app.js" as="script">`;
  assert.equal(assetIndex(preloadOnly, "assets/js/app.js"), -1, "a preload href cannot satisfy a script-order check");
  assert.equal(stylesheetIndex(`<link rel="preload" href="assets/css/obsidian.css" as="style">`, "assets/css/obsidian.css"), -1);
});
