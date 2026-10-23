import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve, dirname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../frontend/astra');

/** Modules reachable from main.js through static imports (dynamic import() is not followed). */
function startupModules() {
  const seen = new Set();
  const walk = file => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm)) {
      const spec = m[1] || m[2];
      if (spec.startsWith('.')) walk(resolve(dirname(file), spec));
    }
  };
  walk(resolve(root, 'src/main.js'));
  return [...seen].map(f => relative(root, f)).filter(f => f !== 'src/main.js').sort();
}

test('index.html preloads exactly the modules the app needs to start', () => {
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  const preloaded = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(m => m[1]).sort();
  assert.deepEqual(preloaded, startupModules());
});

test('the playback engine and Mediabunny are not part of the app start', () => {
  const modules = startupModules();
  assert.deepEqual(modules.filter(m => /engine\/(player|remux|probe|software|mse|mkv|mp4)\.js|vendor\//.test(m) || m.endsWith('player-screen.js')), []);
});
