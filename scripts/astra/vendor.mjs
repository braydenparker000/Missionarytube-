#!/usr/bin/env node
// Copies the pinned Mediabunny packages (package.json) into frontend/astra/vendor/
// as browser modules. The two decoder extensions import the bare specifier
// 'mediabunny'; it is rewritten to './mediabunny.js' so all three share one
// module instance without an import map. Nothing else is changed.
// Usage: node scripts/astra/vendor.mjs [--check]
//   --check exits 1 when a vendored file differs from what this script writes.
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const VENDOR = 'frontend/astra/vendor/';
export const FILES = [
  ['mediabunny.js', 'node_modules/mediabunny/dist/bundles/mediabunny.min.mjs'],
  ['mediabunny-ac3.js', 'node_modules/@mediabunny/ac3/dist/bundles/mediabunny-ac3.min.mjs'],
  ['mediabunny-dts.js', 'node_modules/@mediabunny/dts/dist/bundles/mediabunny-dts.min.mjs'],
];

export function vendored(source) {
  return source.replaceAll('from"mediabunny"', 'from"./mediabunny.js"');
}

export function expected() {
  return FILES.map(([name, from]) => {
    const text = vendored(readFileSync(root + from, 'utf8'));
    if (name !== 'mediabunny.js' && /from\s*["']mediabunny["']/.test(text)) throw Error(`${from}: unrewritten import of 'mediabunny'`);
    return [name, text];
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const [name, text] of expected()) {
    const path = root + VENDOR + name;
    if (check) {
      let current = null;
      try { current = readFileSync(path, 'utf8'); } catch {}
      if (current !== text) { console.error(`${VENDOR}${name} is out of date; run node scripts/astra/vendor.mjs`); stale++; }
    } else writeFileSync(path, text);
  }
  process.exit(stale ? 1 : 0);
}
