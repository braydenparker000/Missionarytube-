import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {gitTree} from '../scripts/source-tree.mjs';
import {historicalBytes,historicalModulePath} from './helpers/historical-source.mjs';
import {access} from 'node:fs/promises';

test('removed application snapshots cannot become build inputs again', async()=>{
  for(const path of ['jarvis','src','daily-board-next'])await assert.rejects(access(path),{code:'ENOENT'});
});

test('historical compatibility fixtures refuse current sources and paths outside the explicit fixture set',()=>{
  for(const path of ['frontend/media/index.html','../package.json','jarvis/public/../backend/worker.js']){
    assert.throws(()=>historicalBytes(path),/Not a retained historical fixture/);
    assert.throws(()=>historicalModulePath(path),/Not a retained historical fixture/);
  }
});

test('source identity detects changed bytes, executable modes and added files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-import-test-'));
  try {
    const file = join(directory, 'module.js');
    await writeFile(file, 'export const value = 1;\n', { mode: 0o644 });
    const original = await gitTree(directory);
    await writeFile(file, 'export const value = 2;\n');
    assert.notEqual(await gitTree(directory), original);
    await writeFile(file, 'export const value = 1;\n');
    assert.equal(await gitTree(directory), original);
    await chmod(file, 0o755);
    assert.notEqual(await gitTree(directory), original);
    await chmod(file, 0o644);
    await writeFile(join(directory, 'extra.js'), '');
    assert.notEqual(await gitTree(directory), original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('deployment command explicitly selects every existing orchestration test, never jarvis tests', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.scripts.test, 'node scripts/check.mjs && node --test tests/*.test.mjs scripts/*.test.mjs scripts/test-jarvis-media.mjs');
  // Refuse silently omitted nested/new-extension tests in either deployment scope.
  const discovered = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/^(?:test|test-.+|.+[.-]test)\.(?:cjs|mjs|js)$/.test(entry.name)) discovered.push(path);
    }
  }
  await walk('tests');
  await walk('scripts');
  assert.ok(discovered.includes('scripts/test-jarvis-media.mjs'));
  assert.ok(discovered.includes('tests/media-app-root.test.mjs'));
  assert.ok(discovered.length >= 86);
  for (const path of discovered) assert.match(path, /^(?:(?:tests|scripts)\/[^/]+\.test\.mjs|scripts\/test-jarvis-media\.mjs)$/);
});
