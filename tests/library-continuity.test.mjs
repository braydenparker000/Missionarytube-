import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../assets/js/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../assets/css/obsidian.css", import.meta.url), "utf8");

test("Library joins saved titles and bounded local playback shelves", () => {
  assert.match(app, /function libraryActivity\(\)/);
  assert.match(app, /return \{recent,finished\}/);
  assert.match(app, /continuing=continueItems\(\)\.slice\(0,CONTINUE_LIMIT\)/);
  assert.match(app, /'Watch history'/);
  assert.match(app, /state.libraryView==='history'\?activity.recent/);
});

test("large saved collections reveal another finite batch", () => {
  assert.match(app, /LIBRARY_BATCH=24/);
  assert.match(app, /items\.slice\(0,state\.libraryVisible\)/);
  assert.match(app, /data-library-load-more/);
  assert.match(app, /state\.libraryVisible\+=LIBRARY_BATCH/);
});

test("the dossier exposes only real device activity", () => {
  assert.match(app, /function dossierActivityHTML\(m\)/);
  assert.match(app, /const entry=latestProgress\(m\),saved=!!state\.library\[mediaKey\(m\)\]/);
  assert.match(app, /Resume at \$\{AstraAudio\.formatTime\(entry\.time\)\}/);
  assert.match(app, /aria-label="Your activity"/);
});

test("continuity shelves stay skippable and compact off screen", () => {
  assert.match(css, /\.library-stack > \.sector \{[^}]*content-visibility: auto;[^}]*contain-intrinsic-size:/s);
  assert.match(css, /@media \(max-width: 419px\)[\s\S]*\.dossier-activity > div \{ grid-template-columns: 1fr; \}/);
});
