import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {expected, VENDOR} from '../scripts/astra/vendor.mjs';

test('vendored Mediabunny matches the pinned packages, with only the import rewritten', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  for (const name of ['mediabunny', '@mediabunny/ac3', '@mediabunny/dts']) assert.match(pkg.dependencies[name], /^\d+\.\d+\.\d+$/, `${name} is pinned exactly`);
  for (const [name, text] of expected()) {
    assert.equal(readFileSync(new URL('../' + VENDOR + name, import.meta.url), 'utf8'), text, `${name}: run node scripts/astra/vendor.mjs`);
    if (name !== 'mediabunny.js') assert.match(text, /from"\.\/mediabunny\.js"/, `${name} shares the one Mediabunny instance`);
  }
  const notice = readFileSync(new URL('../' + VENDOR + 'LICENSES.md', import.meta.url), 'utf8');
  assert.match(notice, new RegExp(`mediabunny@${pkg.dependencies.mediabunny}`));
  assert.match(notice, /Mozilla Public License/);
  assert.match(notice, /FFmpeg/);
});

test('Astra pages declare a CSP that allows the decoder workers and nothing broader', () => {
  const html = readFileSync(new URL('../frontend/astra/lab/index.html', import.meta.url), 'utf8');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval' blob: https:\/\/cdn\.jsdelivr\.net;/);
  assert.match(csp, /worker-src 'self' blob:/);
  assert.doesNotMatch(csp, /'unsafe-inline'|'unsafe-eval'/);
});
