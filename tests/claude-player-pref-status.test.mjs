// Claude Player settings: every reference preference key has a status, built
// keys are read by the app, and the generated table is current (notebook F63).
// Run: node --test tests/claude-player-pref-status.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {PREF_STATUS, prefKeys, UI, BUILT, TODO, WEB, OWNER, NA} from '../frontend/claude-player/src/settings/pref-status.js';
import {render, loadModel, DOC} from '../scripts/claude-player/pref-status.mjs';

const model = loadModel();
const keys = prefKeys(model);
const SRC = new URL('../frontend/claude-player/src/', import.meta.url).pathname;
const sources = (dir => {
  const out = [];
  const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js') && !p.endsWith('pref-status.js')) out.push(readFileSync(p, 'utf8')); } };
  walk(dir);
  return out.join('\n');
})(SRC);

test('every reference key has exactly one known status', () => {
  const statuses = new Set([UI, BUILT, TODO, WEB, OWNER, NA]);
  assert.ok(keys.length > 400);
  for (const {key} of keys) {
    const s = PREF_STATUS[key];
    assert.ok(s, `unclassified key ${key}`);
    assert.ok(statuses.has(s[0]), `${key}: unknown status ${s[0]}`);
    if (s[0] === WEB || s[0] === OWNER || s[0] === NA) assert.ok(s[1], `${key}: a reason is required`);
  }
  const known = new Set(keys.map(k => k.key));
  for (const key of Object.keys(PREF_STATUS)) assert.ok(known.has(key), `${key} is not a reference key`);
});

test('built keys are read by the app', () => {
  for (const [key, [s]] of Object.entries(PREF_STATUS)) {
    if (s === BUILT) assert.ok(new RegExp(`\\b${key}\\b`).test(sources), `${key} is marked built but no source reads it`);
  }
});

test('the generated status table is current', () => {
  assert.equal(readFileSync(DOC, 'utf8'), render(model), 'run node scripts/claude-player/pref-status.mjs');
});
