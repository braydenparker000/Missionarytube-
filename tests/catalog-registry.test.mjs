import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadCatalogs, source } from "./helpers/redesign.mjs";

const Catalogs = await loadCatalogs();

test("identical catalog names from two providers stay distinct", () => {
  const first = source("alpha", [{ id: "popular", type: "movie", name: "Popular" }]);
  const second = source("beta", [{ id: "popular", type: "movie", name: "Popular" }]);
  const entries = [...Catalogs.build([first, second])];

  assert.equal(entries.length, 2);
  assert.notEqual(entries[0].key, entries[1].key);
  assert.notEqual(entries[0].providerKey, entries[1].providerKey);
  assert.deepEqual(entries.map((entry) => entry.providerName), ["alpha", "beta"]);
});

test("opaque preference keys never expose a configured add-on URL", () => {
  const secret = "private-token-that-must-not-reach-the-dom";
  const provider = source("secured", [{ id: "latest", type: "series", name: "Latest" }]);
  provider.addon.url = `https://example.test/${secret}/manifest.json`;
  const [entry] = [...Catalogs.build([provider])];

  assert.ok(entry.key.startsWith("c1:"));
  assert.ok(entry.providerKey.startsWith("p1:"));
  assert.doesNotMatch(entry.key + entry.providerKey, /private-token|manifest\.json|https:/);
});

test("saved order, visibility and hero choices reconcile with current manifests", () => {
  const provider = source("provider", [
    { id: "one", type: "movie", name: "One" },
    { id: "two", type: "series", name: "Two" },
    { id: "three", type: "movie", name: "Three" }
  ]);
  const entries = [...Catalogs.build([provider])];
  const saved = {
    version: 1,
    showHero: false,
    order: [entries[2].key, "c1:stale", entries[0].key],
    catalogs: {
      [entries[2].key]: { visible: false, hero: true, label: "Premieres" },
      "c1:stale": { visible: true }
    }
  };
  const layout = Catalogs.reconcile(entries, saved);
  const ordered = [...Catalogs.ordered(entries, layout, false)];

  assert.deepEqual(ordered.map((entry) => entry.name), ["Three", "One", "Two"]);
  assert.equal(ordered[0].visible, false);
  assert.equal(ordered[0].hero, true);
  assert.equal(ordered[0].displayName, "Premieres");
  assert.equal(layout.showHero, false);
  assert.equal(layout.order.includes("c1:stale"), false);
});

test("catalog controls change one preference without mutating the input", () => {
  const provider = source("provider", [
    { id: "one", type: "movie", name: "One" },
    { id: "two", type: "movie", name: "Two" }
  ]);
  const entries = [...Catalogs.build([provider])];
  const layout = Catalogs.reconcile(entries, Catalogs.defaults());
  const hidden = Catalogs.setCatalog(layout, entries[0].key, { visible: false });
  const moved = Catalogs.move(hidden, entries[1].key, -1);

  assert.equal(layout.catalogs[entries[0].key].visible, true);
  assert.equal(hidden.catalogs[entries[0].key].visible, false);
  assert.equal(moved.order[0], entries[1].key);
  assert.equal(hidden.order[0], entries[0].key);
});

test("media references preserve exact identity while separating providers", () => {
  const id = "id:" + "x".repeat(320);
  const content = { id, type: "series" };
  const first = { ...content, _providerKey: "p1:first" };
  const second = { ...content, _providerKey: "p1:second" };

  assert.equal(Catalogs.contentKey(first), `series:${id}`);
  assert.equal(Catalogs.mediaRef(first).endsWith(`series:${id}`), true);
  assert.notEqual(Catalogs.mediaRef(first), Catalogs.mediaRef(second));
  assert.ok(Catalogs.mediaRef(first).length > 200);
});

test("the app wires provider-safe refs through catalog, Discover and search", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /assets\/js\/catalog-registry\.js/);
  assert.match(html, /state\.metaCache\.set\(ref,item\)/);
  assert.match(html, /data-open="\$\{esc\(mediaRef\(m\)\)\}"/);
  assert.match(html, /Object\.values\(state\.library\)\.find\(x=>mediaRef\(x\.meta\)===key\)\?\.meta/);
  assert.match(html, /findIndex\(n=>mediaRef\(n\)===mediaRef\(m\)\)/);
  assert.match(html, /Every catalog stays attached to the add-on that published it/);
  assert.doesNotMatch(html, /data-browse-catalog="\$\{esc\(s\.addon\.url/);
});

test("Home layout is reachable and exposes mobile-accessible controls", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /function homeLayoutModal\(\)/);
  assert.match(html, /data-layout-visible/);
  assert.match(html, /data-layout-hero/);
  assert.match(html, /data-layout-move/);
  assert.match(html, /data-layout-reset/);
  assert.match(html, /aria-pressed=/);
  assert.match(html, /data-layout-option="showHero" aria-label="Show hero"/);
});
