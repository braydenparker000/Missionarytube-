import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile("index.html", "utf8");

test("the app loads the progress store before its own script", () => {
  const module = html.indexOf('<script src="assets/js/progress-store.js"></script>');
  const app = html.indexOf("<script>\n  (()=>{'use strict';");
  assert.ok(module > -1, "progress-store.js must be loaded");
  assert.ok(app > module, "the app script must run after the store is defined");
  assert.match(html, /const progress=AstraProgress\.createProgressStore\(/);
});

test("no progress write embeds add-on metadata any more", () => {
  assert.equal(html.includes("meta:m}"), false, "progress records must not carry a meta object");
  assert.equal(html.includes("store.set('progress'"), false, "progress is owned by the store module");
  assert.equal(html.includes("state.progress"), false, "the raw progress map is gone");
  assert.match(html, /progress\.record\(m,v,\{time:el\.currentTime,duration:el\.duration\}\)/);
  assert.match(html, /progress\.record\(m,v,\{time:el\.duration,duration:el\.duration,completed:true,immediate:true\}\)/);
});

test("localStorage writes cannot throw out of the app", () => {
  const setter = html.match(/set\(k,v\)\{[^}]*\}[^}]*\}/);
  assert.ok(setter, "store.set must exist");
  assert.match(setter[0], /try\{/);
  assert.match(setter[0], /catch\{storageFailed\(\)/);
  assert.match(html, /const storageArea=\(\(\)=>\{try\{/, "localStorage access itself is guarded");
});

test("pending progress is flushed when playback or the page ends", () => {
  assert.match(html, /window\.addEventListener\('pagehide',\(\)=>progress\.flush\(\)\)/);
  assert.match(html, /document\.visibilityState==='hidden'\)progress\.flush\(\)/);
  assert.match(html, /el\.addEventListener\('pause',\(\)=>progress\.flush\(\)\)/);
});

test("a continue watching card still opens after a reload", () => {
  assert.match(html, /state\.homeItems\.find\(x=>mediaKey\(x\)===key\)\|\|progress\.meta\(key\)/);
});

test("backups round-trip the normalized progress shape", () => {
  assert.match(html, /progress:progress\.snapshot\(\)/);
  assert.match(html, /progress\.replace\(d\.progress\|\|\{\}\)/);
  assert.equal(html.includes("['addons','library','progress','settings']"), false);
});
