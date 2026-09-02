import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile("assets/js/route-runtime.js", "utf8");
const context = { AbortController, console };
vm.runInNewContext(source, context, { filename: "route-runtime.js" });

test("a newer route generation invalidates and aborts the older one", () => {
  const runtime = context.AstraRoutes.createRouteRuntime();
  const first = runtime.begin("home");
  const second = runtime.begin("home");

  assert.equal(first.current(), false);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.current(), true);
  assert.ok(second.generation > first.generation);
});

test("route cleanup runs once in reverse registration order", () => {
  const runtime = context.AstraRoutes.createRouteRuntime();
  const route = runtime.begin("search");
  const calls = [];
  route.onDispose(() => calls.push("observer"));
  route.onDispose(() => calls.push("request"));

  assert.equal(route.release(), true);
  assert.deepEqual(calls, ["request", "observer"]);
  assert.equal(route.release(), false);
  assert.deepEqual(calls, ["request", "observer"]);
});

test("cleanup registered after a route is stale runs immediately", () => {
  const runtime = context.AstraRoutes.createRouteRuntime();
  const route = runtime.begin("library");
  runtime.release("library");
  let cleaned = 0;
  route.onDispose(() => { cleaned += 1; });

  assert.equal(cleaned, 1);
  assert.equal(runtime.current("library"), false);
});
