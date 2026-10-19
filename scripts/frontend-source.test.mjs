import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, readFile, cp, rm, symlink, chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {readFrontendSource, frontendDirectory, checkedFrontendBuild} from './frontend-source.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-frontend-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', stdio: 'pipe'}).trim();
  for (const path of ['frontend/assets', 'frontend/daily-board/v1', 'scripts']) await mkdir(join(root, path), {recursive: true});
  await writeFile(join(root, 'frontend/index.html'), '<!doctype html><html><head><title>Fixture</title></head><body></body></html>');
  await writeFile(join(root, 'frontend/assets/hub.js'), 'export const fixture = true;');
  await writeFile(join(root, 'frontend/daily-board/v1/live.js'), 'export const version = 1;');
  await writeFile(join(root, 'jarvis-release.json'), JSON.stringify({repository: 'braydenparker999/jarvis', commit: 'a'.repeat(40)}));
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  for (const name of ['build-jarvis.mjs', 'frontend-source.mjs', 'check-jarvis-import.mjs', 'r2-player-config.mjs']) await cp(new URL(name, import.meta.url), join(root, 'scripts', name));
  git('init'); git('add', '.');
  const commit = () => git('-c', 'user.name=Frontend fixture', '-c', 'user.email=fixture@example.test', 'commit', '-am', 'fixture');
  commit();
  const build = () => execFileSync(process.execPath, ['scripts/build-jarvis.mjs'], {cwd: root, encoding: 'utf8', stdio: 'pipe'});
  return {root, git, commit, build, release: async () => JSON.parse(await readFile(join(root, 'dist/release.json'), 'utf8'))};
}

test('provenance derives the reviewed commit and exact Git tree without component pin files or an external checkout', async t => {
  const h = await fixture(t);
  h.build();
  const release = await h.release(), source = await readFrontendSource('', {root: h.root});
  assert.equal(source.commit, h.git('rev-parse', 'HEAD'));
  assert.equal(source.tree, h.git('rev-parse', 'HEAD:frontend'));
  assert.equal(source.dirty, false);
  assert.equal(release.components['daily-board'].path, 'frontend/daily-board');
  assert.equal(release.components['daily-board'].tree, h.git('rev-parse', 'HEAD:frontend/daily-board'));
  await checkedFrontendBuild(release, {root: h.root});
});

test('a source edit builds immediately, but publication requires that edit committed and rebuilt', async t => {
  const h = await fixture(t);
  h.build(); const old = await h.release();
  await writeFile(join(h.root, 'frontend/daily-board/v1/live.js'), 'export const version = 2;');
  h.build(); const edited = await h.release();
  assert.equal(await readFile(join(h.root, 'dist/daily-board/v1/live.js'), 'utf8'), 'export const version = 2;');
  assert.equal(edited.frontend.dirty, true);
  assert.notEqual(edited.frontend.tree, old.frontend.tree);
  await assert.rejects(checkedFrontendBuild(edited, {root: h.root}), /reviewed commit/);
  h.commit();
  await assert.rejects(checkedFrontendBuild(edited, {root: h.root}), /stale/);
  h.build(); await checkedFrontendBuild(await h.release(), {root: h.root});
  const changed = h.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD');
  assert.equal(changed, 'frontend/daily-board/v1/live.js', 'the feature commit needs no pin or generated-file edits');
});

test('added routes and changed modes enter generated provenance and cannot borrow a clean receipt', async t => {
  const h = await fixture(t);
  h.build(); const before = await h.release();
  await mkdir(join(h.root, 'frontend/new-route'));
  await writeFile(join(h.root, 'frontend/new-route/index.html'), '<html><head></head><body>New route</body></html>');
  h.build(); const added = await h.release();
  assert.ok(added.components['new-route']);
  assert.equal(added.components['new-route'].dirty, true);
  await assert.rejects(checkedFrontendBuild(added, {root: h.root}), /reviewed commit/);
  await rm(join(h.root, 'frontend/new-route'), {recursive: true});
  await chmod(join(h.root, 'frontend/daily-board/v1/live.js'), 0o755);
  assert.notEqual((await readFrontendSource('', {root: h.root})).tree, before.frontend.tree);
});

test('source selection rejects traversal, symbolic links and missing components without archived fallbacks', async t => {
  const h = await fixture(t);
  for (const component of ['../jarvis/public', '/tmp', 'assets/app.js']) assert.throws(() => frontendDirectory(component, h.root));
  await mkdir(join(h.root, 'jarvis/public/daily-board'), {recursive: true});
  await writeFile(join(h.root, 'jarvis/public/daily-board/live.js'), 'archived');
  await rm(join(h.root, 'frontend/daily-board'), {recursive: true});
  assert.throws(() => frontendDirectory('daily-board', h.root), /ENOENT/);
  await symlink(join(h.root, 'jarvis/public/daily-board'), join(h.root, 'frontend/daily-board'));
  assert.throws(() => frontendDirectory('daily-board', h.root), /real directory/);
  await assert.rejects(readFrontendSource('', {root: h.root}), /Unexpected imported entry type/);
  assert.throws(h.build, /Unexpected imported entry type/);
});

test('music URLs follow editable bytes automatically and document policies remain byte-identical', async t => {
  const h = await fixture(t);
  await mkdir(join(h.root, 'frontend/drawercast/fonts'), {recursive: true});
  const document = '<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'"><meta name="referrer" content="no-referrer"></head><body><script src="./player.js?old"></script><a href="./fonts/font.woff">Font</a></body></html>';
  await writeFile(join(h.root, 'frontend/drawercast/index.html'), document);
  await writeFile(join(h.root, 'frontend/drawercast/player.js'), 'version one');
  await writeFile(join(h.root, 'frontend/drawercast/fonts/font.woff'), 'font bytes');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  h.build();
  const output = () => readFile(join(h.root, 'dist/drawercast/index.html'), 'utf8');
  assert.equal(await output(), document.replace('./player.js?old', `./player.${hash('version one')}.js`).replace('./fonts/font.woff', `./fonts/font.${hash('font bytes')}.woff`));
  await assert.rejects(readFile(join(h.root, 'dist/drawercast/player.js')), {code: 'ENOENT'});
  await writeFile(join(h.root, 'frontend/drawercast/player.js'), 'version two');
  h.build();
  assert.ok((await output()).includes(`./player.${hash('version two')}.js`));
  await assert.rejects(readFile(join(h.root, `dist/drawercast/player.${hash('version one')}.js`)), {code: 'ENOENT'});
  assert.equal(await readFile(join(h.root, `dist/drawercast/player.${hash('version two')}.js`), 'utf8'), 'version two');
});
