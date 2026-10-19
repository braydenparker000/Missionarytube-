import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {recipeIdentity} from './worker-release-identity.mjs';

test('source qualification is complete once, with locked dependencies on each executing runner',async()=>{
  const source=await readFile(new URL('../.github/workflows/qualify-jarvis.yml',import.meta.url),'utf8');
  const component=source.slice(source.indexOf('\n  component:'),source.indexOf('\n  build:'));
  const checkout=component.indexOf('path: .jarvis-source'),install=component.indexOf('run: npm --prefix .jarvis-source ci'),execute=component.indexOf('node scripts/plan-jarvis-qualification.mjs run');
  assert.ok(checkout>=0&&checkout<install&&install<execute);
  assert.doesNotMatch(component.slice(install,execute),/--ignore-scripts|--omit(?:=|\s)|NODE_ENV:\s*production/);
  assert.match(source,/needs: \[plan, component, build, runtime\]/);
  assert.match(source,/test "\$COMPONENT_RESULT" = success/);
  assert.match(await readFile(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8'),/uses: \.\/\.github\/workflows\/qualify-jarvis\.yml/);
  const deploy=await readFile(new URL('../.github/workflows/deploy-azure-storage.yml',import.meta.url),'utf8');
  assert.match(deploy,/node scripts\/guard-validation\.mjs/);
  assert.doesNotMatch(deploy,/npm run test:jarvis|npm --prefix \.jarvis-source test|uses: \.\/\.github\/workflows\/qualify-jarvis\.yml/);
});

test('qualification checkouts use destination history at the unchanged source pin while retaining provenance', async () => {
  const { createHash } = await import('node:crypto');
  const flow = await readFile(new URL('../.github/workflows/qualify-jarvis.yml', import.meta.url), 'utf8');
  const build = flow.slice(flow.indexOf('\n  build:'), flow.indexOf('\n  qualification:'));
  assert.match(build,/uses: actions\/checkout@v4\n        with:\n          persist-credentials: false\n          fetch-depth: 0/,'historical receipt tests need retained destination Git blobs');
  assert.match(build, /repository: braydenparker000\/Missionarytube-\n          ref: \$\{\{ needs\.plan\.outputs\.source \}\}\n          path: \.jarvis-source\n          persist-credentials: false\n          fetch-depth: 0/);
  const plan = flow.slice(flow.indexOf('\n  plan:'), flow.indexOf('\n  component:'));
  const component = flow.slice(flow.indexOf('\n  component:'), flow.indexOf('\n  build:'));
  for (const job of [plan, component]) assert.match(job, /repository: braydenparker000\/Missionarytube-\n          ref: \$\{\{ (?:steps\.source\.outputs\.commit|needs\.plan\.outputs\.source) \}\}\n          path: \.jarvis-source\n          persist-credentials: false\n          fetch-depth: 0/);
  assert.equal((flow.match(/repository: braydenparker000\/Missionarytube-/g) || []).length, 3);
  assert.match(flow, /r\.repository!==\s*'braydenparker999\/jarvis'/);
  const release = JSON.parse(await readFile(new URL('../jarvis-release.json', import.meta.url), 'utf8'));
  assert.equal(release.repository, 'braydenparker999/jarvis');
  assert.equal(release.commit, 'c28c1b2f70aabb5217b08bf31ffe4c93d0353765');
  const bytes = Buffer.from(flow);
  const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert.equal(recipeIdentity().find(item => item.path === '.github/workflows/qualify-jarvis.yml').sha, blob);
});

test('Validate owns push and PR qualification unconditionally and Azure publication stays manual',async()=>{
  const ci=await readFile(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
  assert.match(ci,/on:\n  pull_request:\n  push:\n    branches: \[main\]/);
  const gate=ci.slice(ci.indexOf('  static-checks:'),ci.indexOf('  daily-board-import-candidate:'));
  assert.match(gate,/uses: \.\/\.github\/workflows\/qualify-jarvis\.yml/);
  assert.doesNotMatch(gate,/\b(?:if|needs):/,'no classifier or producer proof can skip the complete qualification');
  assert.doesNotMatch(ci,/gate-owner|partition-main-qualification|verify-main-qualification-producer/);
  const deploy=await readFile(new URL('../.github/workflows/deploy-azure-storage.yml',import.meta.url),'utf8');
  assert.match(deploy,/\n  workflow_dispatch:/);
  assert.doesNotMatch(deploy,/\n  (?:push|pull_request|schedule|workflow_run):/,'deployment cannot start a second qualification on main pushes');
  assert.match(deploy,/node scripts\/guard-validation\.mjs/,'authorized publication still requires its exact successful main validation');
  assert.match(deploy,/github\.event_name == 'workflow_dispatch'/);
  assert.match(deploy,/github\.ref == 'refs\/heads\/main'/);
});
