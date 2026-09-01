import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile("assets/js/federated-search.js", "utf8");
const html = await readFile("index.html", "utf8");
const css = await readFile("assets/css/obsidian.css", "utf8");
const context = {};
vm.runInNewContext(source, context, { filename: "federated-search.js" });
const search = context.AstraSearch;
const plain = (value) => JSON.parse(JSON.stringify(value));

test("exact media identity survives long ids and only deduplicates exact matches", () => {
  const prefix = "episode:" + "x".repeat(260);
  const first = { id: prefix + ":one", type: "series", name: "Astra One" };
  const second = { id: prefix + ":two", type: "series", name: "Astra Two" };
  const merged = plain(search.merge([first], [first, second], "astra"));

  assert.equal(search.contentKey(first), `series:${prefix}:one`);
  assert.ok(search.contentKey(first).length > 200);
  assert.deepEqual(merged.map((item) => item.id), [first.id, second.id]);
});

test("results use stable relevance without rewriting provider order", () => {
  const items = [
    { id: "inside", type: "movie", name: "The Astra File" },
    { id: "word", type: "series", name: "Project Astra" },
    { id: "prefix", type: "movie", name: "Astra Rising" },
    { id: "exact", type: "anime", name: "Astra" }
  ];

  assert.deepEqual(
    plain(search.merge([], items, "astra")).map((item) => item.id),
    ["exact", "prefix", "inside", "word"]
  );
});

test("same-named catalogs from different providers remain separate", () => {
  const groups = plain(search.groupSources([
    { entry: { providerKey: "p1:alpha", providerName: "Alpha" }, cat: { id: "popular" } },
    { entry: { providerKey: "p1:beta", providerName: "Beta" }, cat: { id: "popular" } },
    { entry: { providerKey: "p1:alpha", providerName: "Alpha" }, cat: { id: "search" } }
  ]));

  assert.deepEqual(groups.map((group) => group.key), ["p1:alpha", "p1:beta"]);
  assert.deepEqual(groups.map((group) => group.catalogs.length), [2, 1]);
});

test("local matches and type filters stay deterministic", () => {
  const items = [
    { id: "1", type: "movie", name: "Astra" },
    { id: "2", type: "series", name: "Astra Station" },
    { id: "3", type: "movie", name: "Elsewhere" }
  ];
  const matches = plain(search.localMatches(items, "astra", 10));

  assert.deepEqual(matches.map((item) => item.id), ["1", "2"]);
  assert.deepEqual(plain(search.types(matches)), ["movie", "series"]);
  assert.deepEqual(plain(search.filterType(matches, "series")).map((item) => item.id), ["2"]);
});

test("the app renders and updates each provider independently", () => {
  assert.match(html, /assets\/js\/federated-search\.js/);
  assert.match(html, /AstraSearch\.groupSources\(searchable\)/);
  assert.match(html, /group\.catalogs\.forEach\(source=>\{/);
  assert.match(html, /refreshSearchRun\(run,group\)/);
  assert.match(html, /state\.searchRun!==run\|\|run\.token!==state\.searchSequence/);
  assert.doesNotMatch(html, /Promise\.allSettled\(searchable\.map/);
  assert.match(html, /data-search-provider=/);
  assert.match(html, /data-search-jump=/);
  assert.match(css, /\.search-provider-result/);
  assert.match(css, /\.search-provider-strip/);
});

test("clearing search invalidates late provider responses without touching playback lookup", () => {
  assert.match(html, /state\.query='';state\.searchRun=null;state\.searchSequence\+\+/);
  assert.match(html, /token:\+\+state\.searchToken/, "detail lookup retains its independent lifecycle token");
});
