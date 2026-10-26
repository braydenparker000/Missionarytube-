// Builds frontend/guitar/engine.js from these sources with pinned packages:
//   node scripts/guitar/build.mjs
// Installs the lockfile's exact versions into scripts/guitar/node_modules on
// first run. The built bundle is committed; CI never rebuilds it.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
if (!existsSync(here + 'node_modules/@coderline/alphatab')) execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: here, stdio: 'inherit' });
const { build } = await import(here + 'node_modules/esbuild/lib/main.js');
const out = fileURLToPath(new URL('../../frontend/guitar/', import.meta.url));
await build({ entryPoints: [here + 'worker.js'], outfile: out + 'engine.js', bundle: true, format: 'esm', minify: true, target: 'es2022', legalComments: 'linked' });
await copyFile(here + 'node_modules/@coderline/alphatab/dist/font/Bravura.otf', out + 'vendor/Bravura.otf');
