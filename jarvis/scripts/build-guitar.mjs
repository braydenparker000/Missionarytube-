import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('public/guitar/vendor', { recursive: true });
await copyFile('node_modules/@coderline/alphatab/dist/font/Bravura.otf', 'public/guitar/vendor/Bravura.otf');
await build({ entryPoints: ['guitar/render-worker.ts'], outfile: 'public/guitar/render-worker.js', bundle: true, format: 'esm', minify: true, target: 'es2022', legalComments: 'linked' });
await build({ entryPoints: ['guitar/pdf.ts'], outfile: 'public/guitar/pdf.js', bundle: true, format: 'esm', minify: true, target: 'es2022', legalComments: 'linked', external: ['canvg', 'html2canvas', 'dompurify'] });
