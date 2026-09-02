import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile("assets/js/search-intent.js", "utf8");
const context = {};
vm.runInNewContext(source, context, { filename: "search-intent.js" });
const intent = context.AstraSearchIntent;
const plain = (value) => JSON.parse(JSON.stringify(value));

test("supported clauses become explicit filters and leave a provider query", () => {
  const parsed = plain(intent.parse("dramatic movie under two hours"));
  assert.equal(parsed.text, "dramatic");
  assert.equal(parsed.type, "movie");
  assert.equal(parsed.maxMinutes, 120);
  assert.deepEqual(parsed.filters.map((filter) => filter.label), ["Movies", "Under 2 hr"]);
});

test("genre, type, and runtime filters require evidence on the item", () => {
  const parsed = intent.parse("science fiction movies under 100 minutes");
  assert.equal(intent.matches({ type: "movie", genres: ["Science Fiction"], runtime: "1h 32m" }, parsed), true);
  assert.equal(intent.matches({ type: "series", genres: ["Science Fiction"], runtime: "92 min" }, parsed), false);
  assert.equal(intent.matches({ type: "movie", genres: ["Drama"], runtime: "92 min" }, parsed), false);
  assert.equal(intent.matches({ type: "movie", genres: ["Science Fiction"] }, parsed), false);
});

test("removing a visible filter returns a clean query", () => {
  assert.equal(intent.remove("horror movies under 90 minutes", "duration"), "horror movies");
  assert.equal(intent.remove("horror movies under 90 minutes", "type"), "horror under 90 minutes");
});

test("unsupported natural language remains in the provider query", () => {
  const parsed = plain(intent.parse("something gentle for a rainy evening"));
  assert.equal(parsed.text, "something gentle for a rainy evening");
  assert.deepEqual(parsed.filters, []);
});

test("a pasted YouTube URL is never rewritten as natural language", () => {
  const url = "https://youtube.com/watch?v=dQw4w9WgXcQ";
  const parsed = plain(intent.parse(url));
  assert.equal(parsed.text, url);
  assert.deepEqual(parsed.filters, []);
});
