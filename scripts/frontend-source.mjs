import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {lstatSync} from 'node:fs';
import {readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {importedTree as sourceTree} from './check-jarvis-import.mjs';

const repository = 'braydenparker000/Missionarytube-';
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();

// One directory is editable and buildable. Archived snapshots are never fallbacks.
export function frontendDirectory(component = '', root = process.cwd()) {
  assert.match(component, /^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/, 'Invalid frontend component');
  const directory = resolve(root, 'frontend');
  for (const path of component ? [directory, resolve(directory, component)] : [directory]) {
    const info = lstatSync(path);
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Frontend source must be a real directory');
  }
  return component ? resolve(directory, component) : directory;
}

/** Hash the actual editable bytes and modes. Local edits build, but cannot publish. */
export async function readFrontendSource(component = '', {root = process.cwd(), requireClean = false} = {}) {
  const directory = frontendDirectory(component, root);
  const path = 'frontend' + (component ? '/' + component : '');
  const commit = git(root, 'rev-parse', 'HEAD');
  const tree = await sourceTree(directory);
  let committedTree;
  try { committedTree = git(root, 'rev-parse', `${commit}:${path}`); } catch { /* A new local directory is uncommitted. */ }
  const dirty = tree !== committedTree;
  assert.ok(!requireClean || !dirty, 'Frontend source differs from the reviewed commit; commit and rebuild before publication');
  return {repository, commit, path, tree, dirty};
}

export async function frontendProvenance(options = {}) {
  const frontend = await readFrontendSource('', options);
  const entries = await readdir(frontendDirectory('', options.root), {withFileTypes: true});
  const components = {};
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) components[entry.name] = await readFrontendSource(entry.name, options);
  }
  return {frontend, components};
}

export async function checkedFrontendBuild(release, options = {}) {
  const provenance = await frontendProvenance({...options, requireClean: true});
  assert.deepEqual(release.frontend, provenance.frontend, 'Built frontend provenance is stale');
  assert.deepEqual(release.components, provenance.components, 'Built component provenance is stale');
  return provenance;
}
