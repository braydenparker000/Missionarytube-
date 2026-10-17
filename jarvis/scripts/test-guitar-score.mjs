import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const directory = await mkdtemp(join(tmpdir(), 'jarvis-guitar-'));
try {
  const output = join(directory, 'score.test.mjs');
  await build({ entryPoints: ['guitar/score.test.ts'], outfile: output, bundle: true, platform: 'node', format: 'esm' });
  await import(pathToFileURL(output));
} finally { await rm(directory, { recursive: true, force: true }); }
