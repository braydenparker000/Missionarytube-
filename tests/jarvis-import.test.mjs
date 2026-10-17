import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkJarvisImport, importedTree, IMPORT_TREE } from '../scripts/check-jarvis-import.mjs';

test('imported Jarvis bytes and modes match the exact source tree', async () => {
  assert.equal(await checkJarvisImport(), IMPORT_TREE);
});

test('import guard detects changed bytes, executable modes and added files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-import-test-'));
  try {
    const file = join(directory, 'module.js');
    await writeFile(file, 'export const value = 1;\n', { mode: 0o644 });
    const original = await importedTree(directory);
    await writeFile(file, 'export const value = 2;\n');
    assert.notEqual(await importedTree(directory), original);
    await writeFile(file, 'export const value = 1;\n');
    assert.equal(await importedTree(directory), original);
    await chmod(file, 0o755);
    assert.notEqual(await importedTree(directory), original);
    await chmod(file, 0o644);
    await writeFile(join(directory, 'extra.js'), '');
    assert.notEqual(await importedTree(directory), original);
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
