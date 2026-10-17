import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SOURCE_ONLY_TESTS,
  parsePending,
  scanSource,
  scanTodos,
  sourceOnlyPattern,
  verdict
} from "../scripts/media-qualification.mjs";

const pendingPath = resolve("test-evidence/media-migration/pending-and-discrepancies.md");
const testsDir = resolve("tests");

test("source-only pattern is anchored to the 29 names", () => {
  assert.equal(SOURCE_ONLY_TESTS.length, 29);
  const pattern = new RegExp(sourceOnlyPattern());
  assert.equal(pattern.test(SOURCE_ONLY_TESTS[0]), true);
  assert.equal(pattern.test(`shipped: ${SOURCE_ONLY_TESTS[0]}`), false);
  assert.equal(pattern.test("the reported MP4 H264/AC3 combination has readable video and decodable audio"), false);
});

test("empty todos are scanned and are not ready", () => {
  // The fixture is encoded so this file is not itself a todo when the suite is scanned.
  const source = Buffer.from("CiAgICB0ZXN0KCJrZXB0IiwgKCkgPT4ge30pOwogICAgdGVzdC50b2RvKCJydW5uZXIgdG9kbyIpOwogICAgdGVzdCgiYmxhbmsgcmVhc29uIiwgeyB0b2RvOiAiIiB9LCAoKSA9PiB7fSk7CiAgICB0ZXN0KCJib29sZWFuIHJlYXNvbiIsIHsKICAgICAgdG9kbzogdHJ1ZQogICAgfSwgKCkgPT4ge30pOwogICAgdGVzdCgid3JpdHRlbiByZWFzb24iLCB7CiAgICAgIHRvZG86ICJzdGlsbCBvcGVuIgogICAgfSwgKCkgPT4ge30pOwogIA==", "base64").toString("utf8");
  const todos = scanSource(source, "tests/example.suite.mjs");
  assert.deepEqual(todos.map((item) => item.name), [
    "runner todo",
    "blank reason",
    "boolean reason",
    "written reason"
  ]);
  assert.equal(todos.filter((item) => item.empty).length, 3);
  const result = verdict({ testsPass: true, pending: { malformed: false, items: [] }, todos });
  assert.equal(result.status, "NOT READY");
  assert.equal(result.ready, false);
  assert.ok(result.reasons.includes("todos remain"));
});

test("clearing the pending list while todos remain is not ready", () => {
  const todos = [{ file: "tests/one.suite.mjs", name: "still open", empty: false }];
  const result = verdict({ testsPass: true, pending: { malformed: false, items: [] }, todos });
  assert.equal(result.status, "NOT READY");
  assert.ok(result.reasons.includes("todo not listed: still open"));
});

test("a pending list with no matching todo is not ready", () => {
  const pending = parsePending("```qualification\ntodo\tstill listed\ttests/one.suite.mjs\n```\n");
  assert.equal(pending.malformed, false);
  const result = verdict({ testsPass: true, pending, todos: [] });
  assert.equal(result.status, "NOT READY");
  assert.ok(result.reasons.includes("pending items remain"));
  assert.ok(result.reasons.includes("listed item has no todo: still listed"));
});

test("a missing or malformed qualification block is not ready", () => {
  assert.equal(parsePending("# none\n").malformed, true);
  assert.equal(parsePending("```qualification\ntodo only-two-fields\n```\n").malformed, true);
  assert.equal(parsePending("```qualification\n```\n```qualification\n```\n").malformed, true);
  const missing = verdict({ testsPass: true, pending: parsePending(""), todos: [] });
  assert.equal(missing.status, "NOT READY");
  assert.ok(missing.reasons.includes("pending list missing or malformed"));
});

test("ready requires passing tests, an empty pending list, and zero todos", () => {
  const ready = verdict({ testsPass: true, pending: { malformed: false, items: [] }, todos: [] });
  assert.equal(ready.status, "READY");
  assert.equal(ready.todoCount, 0);
  assert.equal(ready.pendingCount, 0);
  const failed = verdict({ testsPass: false, pending: { malformed: false, items: [] }, todos: [] });
  assert.equal(failed.status, "NOT READY");
  assert.ok(failed.reasons.includes("tests failed"));
});

test("the resolved shipped criteria leave qualification ready", () => {
  const pending = parsePending(readFileSync(pendingPath, "utf8"));
  const todos = scanTodos(testsDir).filter((item) => item.file.startsWith("tests/"));
  assert.equal(pending.malformed, false);
  assert.deepEqual(pending.items, []);
  const key = (item) => `${item.file} ${item.name}`;
  assert.deepEqual(todos.map(key), []);
  const pumpAttach = "shipped: an already-aborted pumpPipeline job passes AbortError through attach()";
  assert.equal(pending.items.some((item) => item.name === pumpAttach), false);
  assert.equal(todos.some((item) => item.name === pumpAttach), false);
  const result = verdict({ testsPass: true, pending, todos });
  assert.equal(result.status, "READY");
  assert.equal(result.todoCount, 0);
  assert.equal(result.pendingCount, 0);
  assert.deepEqual(result.reasons, []);
});
