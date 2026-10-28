// Copies the pinned PDF engine (pdf.js, see package.json) into frontend/library/vendor.
// Run after changing the version, and commit the result: node scripts/library/build.mjs
// The first run installs the exact version into scripts/library/node_modules (ignored).
import {execFileSync} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, readdirSync, rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, 'node_modules', 'pdfjs-dist');
if (!existsSync(pkg)) execFileSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'], {cwd: here, stdio: 'inherit'});
const out = join(here, '..', '..', 'frontend', 'library', 'vendor');
rmSync(out, {recursive: true, force: true});
mkdirSync(join(out, 'wasm'), {recursive: true});
cpSync(join(pkg, 'build', 'pdf.min.mjs'), join(out, 'pdf.js'));
cpSync(join(pkg, 'build', 'pdf.worker.min.mjs'), join(out, 'pdf.worker.js'));
cpSync(join(pkg, 'LICENSE'), join(out, 'LICENSE-pdfjs.txt'));
// Decoders for scanned pages (JPEG 2000, JBIG2) and colour profiles, with their licences.
for (const f of readdirSync(join(pkg, 'wasm'))) if (/\.wasm$|^LICENSE/.test(f) && !/quickjs/i.test(f)) cpSync(join(pkg, 'wasm', f), join(out, 'wasm', f));
// The 14 standard PDF fonts, for books that do not embed them.
cpSync(join(pkg, 'standard_fonts'), join(out, 'standard_fonts'), {recursive: true});
// The colour profile for print-ready (CMYK) pages.
cpSync(join(pkg, 'iccs'), join(out, 'iccs'), {recursive: true});
console.log('pdf.js', JSON.parse(String(execFileSync('node', ['-p', 'JSON.stringify(require("./package.json").version)'], {cwd: pkg}))), '→', out);
