import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEPLOY_PATHS, MAX_DEPLOY_ONLY_PATHS, recognizedDeployTrigger, matchesDeployPath,
  changesGateRecipe, recognizedGatingRecipes, classifyMainPush } from '../scripts/partition-main-qualification.mjs';
import { producerFixture } from './helpers/main-qualification-producer-fixture.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const deploy = read('.github/workflows/deploy-azure-storage.yml');
const ci = read('.github/workflows/ci.yml');
const qualification = read('.github/workflows/qualify-jarvis.yml');
const before = 'a'.repeat(40), after = 'b'.repeat(40);
const event = () => ({ ref: 'refs/heads/main', repository: { full_name: 'braydenparker000/Missionarytube-' },
  created: false, deleted: false, forced: false, before, after });
function mustQualify(eventName, result, output, verified) {
  const proof = arguments.length < 4 ? 'true' : verified;
  return eventName !== 'push' || result !== 'success' || output !== 'true' || proof !== 'true';
}
const fixtureGit = (paths, options = {}) => args => {
  if (options.fail === args[0]) throw Error('fixture unavailable');
  switch (args[0]) {
    case 'rev-parse': return (options.head || after) + '\n';
    case 'cat-file': return '';
    case 'merge-base': return '';
    case 'rev-list': return (options.count ?? '1') + '\n';
    case 'diff': return options.raw ?? paths.map(path => path + '\0').join('');
    default: throw Error('Unexpected Git operation');
  }
};
const classify = (paths, options = {}, input = {}) => classifyMainPush({
  eventName: 'push', event: event(), headSha: after, ...input,
}, { git: fixtureGit(paths, options), workflow: options.workflow ?? deploy,
  qualificationWorkflow: options.qualificationWorkflow ?? qualification });

test('reviewed path partition is exactly the existing Deploy list, with unchanged events and main branch', () => {
  assert.deepEqual(DEPLOY_PATHS, ['jarvis-release.json', 'scripts/*jarvis*.mjs', 'scripts/r2-player-config.mjs',
    'tests/**', '*.html', 'assets/**', 'src/**', 'scripts/build.mjs', 'package.json', 'package-lock.json',
    '.github/workflows/deploy-azure-storage.yml']);
  const paths = deploy.slice(deploy.indexOf('    paths:\n'), deploy.indexOf('\npermissions:'))
    .split('\n').filter(line => /^      - /u.test(line)).map(line => JSON.parse(line.slice(8)));
  assert.deepEqual(paths, DEPLOY_PATHS);
  assert.equal(recognizedDeployTrigger(deploy), true);
  assert.equal(recognizedGatingRecipes(deploy, qualification), true);
  assert.equal(MAX_DEPLOY_ONLY_PATHS, 300);
});

test('push/main remains unfiltered; PR qualification and existing manual Deploy stay unconditional', () => {
  const triggers = ci.slice(ci.indexOf('\non:\n'), ci.indexOf('\npermissions:'));
  assert.equal(triggers, '\non:\n  pull_request:\n  push:\n    branches: [main]\n');
  assert.match(ci, /permissions:\n  contents: read\n/u);
  assert.doesNotMatch(ci, /id-token:|contents: write|actions: read|secrets:|secrets\.|workflow_run:/u);
  assert.match(ci, /group: validate-\$\{\{ github\.ref \}\}\n  cancel-in-progress: true/u);
  assert.match(ci, /fetch-depth: 0/u);
  assert.match(ci, /persist-credentials: false/u);
  assert.match(ci, /node-version: '22\.23\.3'/u);
  assert.match(ci, /if: \$\{\{ always\(\) && !cancelled\(\) && \(github\.event_name != 'push' \|\| needs\.gate-owner\.result != 'success' \|\| needs\.gate-owner\.outputs\.deploy_only != 'true' \|\| needs\.gate-owner\.outputs\.qualification_verified != 'true'\) \}\}/u);
  assert.match(ci, /static-checks:[\s\S]*uses: \.\/\.github\/workflows\/qualify-jarvis\.yml\n    permissions:\n      contents: read/u);
  assert.match(deploy, /jobs:\n  qualification:\n    uses: \.\/\.github\/workflows\/qualify-jarvis\.yml\n    permissions:\n      contents: read\n  deploy:\n    needs: qualification/u);
  assert.match(qualification, /needs: \[plan, component, build\]/u);
  for (const name of ['PLAN', 'COMPONENT', 'BUILD']) assert.ok(qualification.includes(`test "$${name}_RESULT" = success`));
  for (const eventName of ['pull_request', 'workflow_dispatch', 'merge_group', undefined]) {
    for (const output of ['true', 'false', '', undefined]) assert.equal(mustQualify(eventName, 'success', output), true);
    assert.equal(classify(['jarvis-release.json'], {}, { eventName }).deployOnly, false);
  }
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) assert.equal(mustQualify('push', result, 'true'), true);
  for (const output of ['false', '', 'TRUE', 'true\n', undefined]) assert.equal(mustQualify('push', 'success', output), true);
  for (const verified of ['false', '', 'TRUE', 'true\n', undefined]) assert.equal(mustQualify('push', 'success', 'true', verified), true);
});

const known = ['jarvis-release.json', 'index.html', 'playback-check.html', 'assets/app.js',
  'assets/nested/deeper/icon.svg', 'src/main.js', 'src/nested/helpers.mjs', 'tests/release.test.mjs',
  'tests/main-qualification-partition.test.mjs', 'tests/jarvis-release-latency.test.mjs',
  'scripts/jarvis-release-latency.mjs'];
const recipes = ['scripts/build-jarvis.mjs', 'scripts/check-jarvis-api.mjs', 'scripts/r2-player-config.mjs',
  'scripts/build.mjs', 'tests/nested/fixture.json', 'tests/helpers/harness.mjs', 'tests/browser/youtube-flow.mjs',
  'tests/ci-test-inventory.mjs', 'tests/nested/regression.test.mjs', 'package.json', 'package-lock.json',
  '.github/workflows/deploy-azure-storage.yml'];
const unknown = ['docs/README.md', 'README.md', 'AGENTS.md', 'new-kind/file.bin',
  'scripts/qualified-artifact.mjs', 'scripts/partition-main-qualification.mjs',
  'scripts/nested/build-jarvis.mjs', 'scripts/build-jarvis.js', 'nested/index.html',
  'test/release.test.mjs', 'public/index.html', 'Assets/app.js', 'srcish/main.js',
  'package-lock.json.backup', 'jarvis-release.json.backup', '.github/workflows/ci.yml',
  '.github/workflows/qualify-jarvis.yml', '.github/workflows/unknown.yml'];

for (const path of known) test(`unchanged-recipe ordinary ${path} push delegates one complete gate`, () => {
  assert.equal(matchesDeployPath(path), true);
  assert.equal(changesGateRecipe(path), false);
  assert.equal(classify([path]).deployOnly, true);
});
for (const path of recipes) test(`Deploy-triggering recipe ${path} also keeps full Validate`, () => {
  assert.equal(matchesDeployPath(path), true);
  assert.equal(changesGateRecipe(path), true);
  assert.equal(classify([path]).deployOnly, false);
});
for (const path of unknown) test(`unknown/nondeploy/workflow path ${path} keeps full Validate`, () => {
  assert.equal(matchesDeployPath(path), false);
  assert.equal(classify([path]).deployOnly, false);
  assert.equal(classify(['jarvis-release.json', path]).deployOnly, false);
});

test('all nonempty representative sets have union coverage, with overlap allowed and no Deploy expansion', () => {
  const paths = [...known, ...recipes, ...unknown];
  for (const first of paths) for (const second of paths) {
    const changed = [...new Set([first, second])];
    const result = classify(changed);
    const deployTriggered = changed.some(matchesDeployPath);
    const validateTriggered = mustQualify('push', 'success', String(result.deployOnly));
    assert.ok(deployTriggered || validateTriggered, JSON.stringify(changed));
    if (result.deployOnly) assert.ok(changed.every(path => matchesDeployPath(path) && !changesGateRecipe(path)));
    if (changed.some(path => !matchesDeployPath(path) || changesGateRecipe(path))) assert.equal(validateTriggered, true);
  }
  assert.equal(classify([]).deployOnly, false, 'Empty native path filters would skip both; always-triggered CI does not');
});

test('ordinary regression and timing-tool follow-ups delegate complete npm test without broadening unknown tools', () => {
  assert.equal(classify(['tests/jarvis-release-latency.test.mjs', 'scripts/jarvis-release-latency.mjs']).deployOnly, true);
  assert.equal(classify(['tests/main-qualification-partition.test.mjs']).deployOnly, true);
  assert.equal(classify(['tests/jarvis-release-latency.test.mjs', 'docs/RELEASE-LATENCY.md']).deployOnly, false);
  for (const path of ['tests/helpers/harness.mjs', 'tests/ci-test-inventory.mjs', 'scripts/plan-jarvis-qualification.mjs'])
    assert.equal(classify(['tests/jarvis-release-latency.test.mjs', path]).deployOnly, false);
  assert.equal(classify(['scripts/new-jarvis-timing-tool.mjs']).deployOnly, false);
  const workflowSources = ['.github/workflows/qualify-jarvis.yml', '.github/workflows/deploy-azure-storage.yml']
    .map(read).join('\n');
  assert.doesNotMatch(workflowSources, /scripts\/jarvis-release-latency\.mjs/u);
  for (const script of ['scripts/plan-jarvis-qualification.mjs', 'scripts/install-jarvis-browser.mjs',
    'scripts/qualified-artifact.mjs', 'scripts/build-jarvis.mjs']) assert.doesNotMatch(read(script), /jarvis-release-latency/u);
});

test('missing/truncated/ambiguous Git history never authorizes skipping qualification', () => {
  for (const operation of ['rev-parse', 'cat-file', 'merge-base', 'rev-list', 'diff'])
    assert.equal(classify(['jarvis-release.json'], { fail: operation }).deployOnly, false, operation);
  for (const count of ['0', '', 'unknown', '-1', '1001', '999999999999999999999'])
    assert.equal(classify(['jarvis-release.json'], { count }).deployOnly, false);
  assert.equal(classify(['jarvis-release.json'], { head: before }).deployOnly, false);
  assert.equal(classify([], { raw: 'jarvis-release.json' }).deployOnly, false);
  assert.equal(classify([], { raw: 'jarvis-release.json\0\0' }).deployOnly, false);
  assert.equal(classify(['jarvis-release.json', 'jarvis-release.json']).deployOnly, false);
  assert.equal(classify(Array.from({ length: 300 }, (_, i) => `assets/${i}.js`)).deployOnly, true);
  assert.equal(classify(Array.from({ length: 301 }, (_, i) => `assets/${i}.js`)).deployOnly, false);
  assert.equal(classify(Array.from({ length: 3001 }, (_, i) => `assets/${i}.js`)).deployOnly, false);
});

test('wrong target, creation/deletion, force and missing SHA/event fields all retain full CI', () => {
  for (const delta of [{ created: true }, { deleted: true }, { forced: true }, { forced: undefined },
    { created: undefined }, { deleted: undefined }, { before: '0'.repeat(40) }, { before: undefined },
    { after: undefined }, { after: before }, { before: after.toUpperCase() },
    { ref: 'refs/heads/other' }, { repository: { full_name: 'untrusted/fork' } }])
    assert.equal(classify(['jarvis-release.json'], {}, { event: { ...event(), ...delta } }).deployOnly, false);
  assert.equal(classify(['jarvis-release.json'], {}, { event: null }).deployOnly, false);
  assert.equal(classify(['jarvis-release.json'], {}, { headSha: undefined }).deployOnly, false);
});

test('unsupported path spellings and control characters are conservative', () => {
  for (const path of ['', '/assets/x.js', './assets/x.js', 'assets/../x.js', 'assets//x.js',
    'assets/x\ny.js', 'assets/x\ty.js', 'assets/x\\y.js', 'assets/x\0y.js', null]) {
    assert.equal(matchesDeployPath(path), false);
    assert.equal(classify([path]).deployOnly, false);
  }
});

test('partition drift, negations, aliases, unsupported syntax and changed branch/events fail closed', () => {
  const changed = [deploy.replace('      - "assets/**"\n', ''),
    deploy.replace('      - "assets/**"', '      - "assets/*"'),
    deploy.replace('      - "assets/**"', '      - "**"'),
    deploy.replace('      - "assets/**"', '      - "!assets/private/**"'),
    deploy.replace('      - main', '      - release'),
    deploy.replace('  workflow_dispatch:', '  pull_request:'),
    deploy.replace('    paths:', '    paths-ignore:'),
    deploy.replace('    paths:', '    paths: &deployment_paths'),
    deploy.replace('  push:', '  push:\n    tags: ["*"]'),
    deploy.replace('on:\n', 'on: [push, workflow_dispatch]\n'),
    ...['on', '"on"', "'on'", 'on ', 'on\t', '!!str on', '"\\u006f\\u006e"']
      .map(key => deploy + `\n${key}:\n  workflow_dispatch:\n`),
    deploy + '\nunknown: value\n', 'on:\n  push:\n', ''];
  for (const workflow of changed) {
    assert.equal(recognizedDeployTrigger(workflow), false);
    assert.equal(classify(['jarvis-release.json'], { workflow }).deployOnly, false);
  }
});

test('earlier gate-recipe drift also keeps full CI on a later release-only push', () => {
  for (const workflow of [deploy + '\n# previously changed\n',
    deploy.replace('  qualification:\n', "  qualification:\n    if: ${{ false }}\n")]) {
    assert.equal(recognizedDeployTrigger(workflow), true);
    assert.equal(recognizedGatingRecipes(workflow, qualification), false);
    assert.equal(classify(['jarvis-release.json'], { workflow }).deployOnly, false);
  }
  for (const qualificationWorkflow of [qualification + '\n# previously changed\n',
    qualification.replace('test "$PLAN_RESULT" = success', 'true')]) {
    assert.equal(recognizedGatingRecipes(deploy, qualificationWorkflow), false);
    assert.equal(classify(['jarvis-release.json'], { qualificationWorkflow }).deployOnly, false);
  }
});

function gitFixture() {
  const root = mkdtempSync(join(tmpdir(), 'main-gate-partition-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = (path, value = path) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  git('init', '-q'); git('config', 'user.name', 'Qualification fixture'); git('config', 'user.email', 'fixture@example.test');
  const commit = () => { git('add', '-A'); git('commit', '-qm', 'Fixture change', '--allow-empty'); return git('rev-parse', 'HEAD'); };
  put('.github/workflows/deploy-azure-storage.yml', deploy); put('.github/workflows/qualify-jarvis.yml', qualification);
  put('assets/old.js'); put('docs/old.md'); put('src/start.js');
  const base = commit();
  const run = (previous = base, current = git('rev-parse', 'HEAD')) => classifyMainPush({ eventName: 'push',
    event: { ...event(), before: previous, after: current }, headSha: current, root });
  return { root, git, put, commit, base, run, clean: () => rmSync(root, { recursive: true, force: true }) };
}

for (const [description, mutate, expected] of [
  ['deleted deploy asset', f => rmSync(join(f.root, 'assets/old.js')), true],
  ['deleted unknown document', f => rmSync(join(f.root, 'docs/old.md')), false],
  ['renamed deploy asset to deploy asset', f => renameSync(join(f.root, 'assets/old.js'), join(f.root, 'assets/new.js')), true],
  ['renamed deploy asset to unknown path', f => renameSync(join(f.root, 'assets/old.js'), join(f.root, 'docs/new.md')), false],
  ['renamed unknown document into deploy paths', f => renameSync(join(f.root, 'docs/old.md'), join(f.root, 'assets/new.js')), false],
  ['modified qualification workflow', f => f.put('.github/workflows/qualify-jarvis.yml', 'new qualification'), false],
  ['ordinary regression test edit', f => f.put('tests/release.test.mjs', "import test from 'node:test'; test('new regression', () => {});"), true],
  ['qualification harness edit', f => f.put('tests/helpers/harness.mjs', 'new execution harness'), false],
  ['modified Deploy workflow with same path filter', f => f.put('.github/workflows/deploy-azure-storage.yml', deploy + '\n# changed recipe\n'), false],
]) test(`real exact Git diff handles ${description}`, () => {
  const f = gitFixture();
  try { mutate(f); f.commit(); assert.equal(f.run().deployOnly, expected); } finally { f.clean(); }
});

test('real empty commit and change-then-revert push retain complete qualification', () => {
  const f = gitFixture();
  try {
    f.commit(); assert.equal(f.run().deployOnly, false);
    f.put('assets/old.js', 'changed'); f.commit(); f.put('assets/old.js', 'assets/old.js'); f.commit();
    assert.equal(f.run().deployOnly, false);
  } finally { f.clean(); }
});

test('real nonancestor and unknown before SHAs retain complete qualification', () => {
  const f = gitFixture();
  try {
    f.put('assets/old.js', 'first branch'); const first = f.commit();
    f.git('checkout', '--detach', f.base); f.put('assets/old.js', 'second branch'); f.commit();
    assert.equal(f.run(first).deployOnly, false);
    assert.equal(f.run('e'.repeat(40)).deployOnly, false);
  } finally { f.clean(); }
});

for (const [description, mutate] of [
  ['prior qualification change', f => f.put('.github/workflows/qualify-jarvis.yml', qualification + '\n# prior recipe\n')],
  ['prior Deploy qualification bypass', f => f.put('.github/workflows/deploy-azure-storage.yml',
    deploy.replace('  qualification:\n', "  qualification:\n    if: ${{ false }}\n"))],
  ['prior alternate YAML on key', f => f.put('.github/workflows/deploy-azure-storage.yml', deploy + '\n"on":\n  workflow_dispatch:\n')],
]) test(`real two-push history stays full after ${description}`, () => {
  const f = gitFixture();
  try {
    mutate(f); const previous = f.commit();
    f.put('assets/old.js', 'ordinary later deploy asset'); f.commit();
    assert.equal(f.run(previous).deployOnly, false);
  } finally { f.clean(); }
});

test('invalid UTF-8 Git paths retain complete qualification instead of being decoded lossily', () => {
  const f = gitFixture();
  try {
    const path = Buffer.concat([Buffer.from(join(f.root, 'assets') + '/'), Buffer.from([0xff]), Buffer.from('.txt')]);
    writeFileSync(path, 'Unknown byte spelling'); f.commit();
    assert.equal(f.run().deployOnly, false);
  } finally { f.clean(); }
});

test('CLI defaults closed, has no provider access and distinguishes delegation from successful qualification', () => {
  const f = gitFixture();
  try {
    f.put('assets/old.js', 'changed'); const current = f.commit();
    const eventFile = join(f.root, 'event.json'), output = join(f.root, 'output'), summary = join(f.root, 'summary');
    writeFileSync(eventFile, JSON.stringify({ ...event(), before: f.base, after: current }));
    const script = fileURLToPath(new URL('../scripts/partition-main-qualification.mjs', import.meta.url));
    const proof = producerFixture(current, Date.now());
    const hook = `const fixture=${JSON.stringify(proof)}; globalThis.fetch=async url=>new Response(JSON.stringify(
      url.includes('/deploy-azure-storage.yml') ? fixture.workflow : url.includes('/workflows/42/runs?')
      ? {total_count:1,workflow_runs:[fixture.run]} : url.includes('/attempts/1/jobs?')
      ? {total_count:fixture.jobs.length,jobs:fixture.jobs} : fixture.latest));`;
    const args = ['--import', 'data:text/javascript;base64,' + Buffer.from(hook).toString('base64'), script];
    const env = { ...process.env, GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: eventFile, GITHUB_SHA: current,
      GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary };
    const run = spawnSync(process.execPath, args, { cwd: f.root, env, encoding: 'utf8' });
    assert.equal(run.status, 0); assert.equal(readFileSync(output, 'utf8'), 'deploy_only=true\nqualification_verified=true\n');
    assert.match(readFileSync(summary, 'utf8'), /Verified completed-success qualification in exact Deploy run 81, attempt 1/u);
    assert.match(readFileSync(summary, 'utf8'), /no live or production deployment success is claimed/u);
    writeFileSync(output, ''); writeFileSync(eventFile, '{ malformed');
    const fallback = spawnSync(process.execPath, args, { cwd: f.root, env, encoding: 'utf8' });
    assert.equal(fallback.status, 0); assert.equal(readFileSync(output, 'utf8'), 'deploy_only=false\nqualification_verified=false\n');
    const noOutput = spawnSync(process.execPath, args, { cwd: f.root, env: { ...env, GITHUB_OUTPUT: '' }, encoding: 'utf8' });
    assert.notEqual(noOutput.status, 0, 'An output publication failure must make the job fail and the workflow choose full CI');
    assert.doesNotMatch(read('scripts/partition-main-qualification.mjs'), /fetch\(|https?:\/\/|process\.env\.(?:AZURE|CLOUDFLARE|.*TOKEN|.*SECRET)/u);
  } finally { f.clean(); }
});
