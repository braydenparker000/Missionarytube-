import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, appendFileSync, lstatSync} from 'node:fs';
import {execFileSync, spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inventory, requireBrowser, performance} from '../tests/helpers/ci-test-inventory.mjs';
import {BROWSER_IDENTITY} from './install-qualification-browser.mjs';

export const REPOSITORY = 'braydenparker999/jarvis';
// Exact repository-owned release refs; never accept arbitrary branches or PR runs.
export const TRUSTED_BRANCHES = ['main', 'release/astra-live-backport-20261009', 'release/ci-reuse-repair-20261011'];
export const WORKFLOW = '.github/workflows/validate-r2.yml';
export const COMPONENTS = ['relay', 'frontend', 'poweramp', 'blankLibrary', 'podcasts', 'migration', 'performance', 'owner24'];
export const BASELINES = ['04ef034738e6a3ccc2c03391ea9b00e0fc98ae66', '8aa7fce4dd83d5417614ae112134631dd98df7b6'];
export const RECIPE = [WORKFLOW, 'scripts/qualification-proof.mjs', 'scripts/install-qualification-browser.mjs', 'tests/helpers/ci-test-inventory.mjs'];
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const blob = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const heavyTest = path => /^tests\/(?:poweramp|drawercast|audio-fidelity|r2-playback|drive-catalog)/.test(path);

// Unknown/new top-level inputs invalidate every component. Components also
// include the complete inventory and recipe, so added/deleted/renamed tests,
// dependencies or qualification changes cannot quietly reuse older coverage.
// The Worker bundles modules and data from public/drawercast and public/content.
// Keep those whole directories, backend code, and shared fixtures closed over
// every lane, including future files; a named-file allowlist would go stale.
export function inputOwners(path, coverage) {
  if (path.startsWith('tests/')) {
    if (path.startsWith('tests/helpers/')) return COMPONENTS;
    if (performance.includes(path)) return ['performance'];
    if (coverage.groups.relay.includes(path) || path === 'tests/relay-fixture.js') return ['relay', 'owner24'];
    if (coverage.groups.blankLibrary.includes(path)) return ['blankLibrary'];
    if (coverage.groups.podcasts.includes(path)) return ['podcasts'];
    if (coverage.groups.regressions.includes(path)) return [heavyTest(path) ? 'poweramp' : 'frontend'];
    if (/^tests\/test_r2.*\.py$/.test(path)) return ['migration'];
    return COMPONENTS;
  }
  if (path.startsWith('public/drawercast/') || path.startsWith('public/content/')) return COMPONENTS;
  if (/^public\/assets\/(?:r2-config\.json|drive-config\.json|pip-diagnostics\.js)$/.test(path)) return COMPONENTS;
  if (path === 'public/staticwebapp.config.json') return COMPONENTS;
  if (path.startsWith('public/')) return ['frontend', 'relay', 'owner24', 'podcasts'];
  if (path.startsWith('backend/')) return COMPONENTS;
  if (path.startsWith('relay-egress/') || path.startsWith('deploy/relay-egress-vercel/')) return ['relay', 'owner24'];
  if (path === 'scripts/build-poweramp-preview.mjs') return ['poweramp', 'blankLibrary', 'performance'];
  if (/^scripts\/(?:migrate-drive-to-r2\.py|publish-r2-partial\.py)$/.test(path)) return ['migration', 'frontend'];
  return COMPONENTS;
}

export function makePlan(entries, environment) {
  if (!Array.isArray(entries) || entries.some(e => !e || typeof e.path !== 'string' || !SHA.test(e.sha) || !['100644','100755'].includes(e.mode || '100644'))) throw Error('Invalid immutable source inventory or file type');
  if (new Set(entries.map(e => e.path)).size !== entries.length) throw Error('Duplicate source path');
  if (!environment || !/^v22\.[0-9]+\.[0-9]+$/.test(environment.node22) || !/^v24\.[0-9]+\.[0-9]+$/.test(environment.node24) ||
      typeof environment.browser !== 'string' || !/^(?:Google Chrome(?: for Testing)?|Chromium) [0-9]+\./.test(environment.browser) ||
      !/^Python 3\.12\.[0-9]+$/.test(environment.python || '') || environment.platform !== 'ubuntu-24.04-x64' || environment.measurement !== 'full-isolated-serial-v1') throw Error('Missing or unexpected qualification runtime/browser/measurement identity');
  const sorted = entries.map(({path, sha, mode = '100644'}) => ({path, sha, mode})).sort((a,b) => a.path.localeCompare(b.path));
  const coverage = inventory(sorted.filter(e => /^tests\/[^/]+\.test\.js$/.test(e.path)).map(e => e.path));
  const tests = {...coverage.groups,
    frontend: coverage.groups.regressions.filter(p => !heavyTest(p)),
    poweramp: coverage.groups.regressions.filter(heavyTest), owner24: coverage.groups.relay};
  const recipe = RECIPE.map(path => {const found = sorted.find(e => e.path === path); if (!found) throw Error('Missing trusted qualification recipe: ' + path); return found;});
  const components = Object.fromEntries(COMPONENTS.map(name => {
    const inputs = sorted.filter(e => inputOwners(e.path, coverage).includes(name));
    const identity = {schema:1, name, inputs, inventory:coverage, recipe, environment, baselines:BASELINES};
    return [name, {digest:hash(identity), tests:tests[name] || [], inputs}];
  }));
  return {schema:1, repository:REPOSITORY, workflow:WORKFLOW, recipe, environment, coverage, components,
    sourceDigest:hash(sorted), digest:hash({schema:1, sorted, coverage, recipe, environment, baselines:BASELINES})};
}

export function checkedRun(run, {sourceSha, workflowId} = {}) {
  if (!run || run.repository?.full_name !== REPOSITORY || run.head_repository?.full_name !== REPOSITORY || run.head_repository?.fork === true ||
      run.event !== 'push' || !TRUSTED_BRANCHES.includes(run.head_branch) || run.path !== WORKFLOW || run.status !== 'completed' || run.conclusion !== 'success' ||
      !SHA.test(run.head_sha || '') || !Number.isSafeInteger(run.id) || run.id < 1 || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1 ||
      (sourceSha && run.head_sha !== sourceSha) || (workflowId && run.workflow_id !== workflowId)) throw Error('Run is not a trusted successful source qualification');
  return run;
}

export function checkedJobs(jobs, run, names) {
  if (!Array.isArray(jobs) || jobs.some(j => j.run_id !== run.id || j.run_attempt !== run.run_attempt || j.head_sha !== run.head_sha)) throw Error('Mixed or missing qualification run attempt or source SHA');
  for (const name of names) {
    const found = jobs.filter(job => job.name === name);
    if (found.length !== 1 || found[0].status !== 'completed' || found[0].conclusion !== 'success') throw Error('Missing, duplicated, failed or skipped qualification job: ' + name);
  }
  return true;
}

export function checkedRecipe(tree, plan) {
  if (!tree || tree.truncated !== false || !Array.isArray(tree.tree)) throw Error('Incomplete immutable recipe tree');
  for (const entry of plan.recipe) {
    const found = tree.tree.filter(e => e.path === entry.path && e.type === 'blob');
    if (found.length !== 1 || found[0].sha !== entry.sha || (found[0].mode || '100644') !== entry.mode) throw Error('Qualification implementation differs at the immutable source revision');
  }
  return true;
}

// Only bounded GETs to public GitHub metadata; no authentication or artifact
// credentials, redirects, caches, logs, or mutable branch-content lookups.
export function publicClient(fetcher = globalThis.fetch, {budget = 12} = {}) {
  let calls = 0;
  return async path => {
    if (!path.startsWith('/repos/' + REPOSITORY + '/') || path.includes('..') || ++calls > budget) throw Error('Public qualification metadata budget exhausted');
    const response = await fetcher('https://api.github.com' + path, {method:'GET', redirect:'error',
      headers:{Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28'}, signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw Error('Public qualification proof unavailable; full qualification required');
    return response.json();
  };
}

async function jobsForRun(api, run) {
  const result = await api(`/repos/${REPOSITORY}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=1`);
  if (!Number.isSafeInteger(result.total_count) || result.total_count < 1 || !Array.isArray(result.jobs) || result.total_count !== result.jobs.length) throw Error('Incomplete qualification job page');
  return result.jobs;
}

export async function findProof(plan, {sourceSha, fetcher, currentRunId} = {}) {
  if (sourceSha && !SHA.test(sourceSha)) throw Error('An exact source SHA is required');
  const api = publicClient(fetcher);
  const fallback = {qualified:false, reuse:{}, reason:'No verified successful qualification for the current inputs'};
  try {
    const data = await api(`/repos/${REPOSITORY}/actions/workflows/validate-r2.yml/runs?event=push&status=success&per_page=3${sourceSha ? '&head_sha=' + sourceSha : ''}`);
    if (!Array.isArray(data.workflow_runs)) throw Error('Invalid qualification run list');
    const reuse = {};
    for (const candidate of data.workflow_runs) {
      if (candidate.id === Number(currentRunId)) continue;
      let run;
      try {run = checkedRun(candidate, {sourceSha});} catch {continue;}
      const tree = await api(`/repos/${REPOSITORY}/git/trees/${run.head_sha}?recursive=1`);
      try {checkedRecipe(tree, plan);} catch {continue;}
      const jobs = await jobsForRun(api, run);
      const final = jobs.filter(j => /^qualified-source-[a-f0-9]{64}$/.test(j.name));
      if (final.length !== 1) continue;
      try {checkedJobs(jobs, run, [final[0].name]);} catch {continue;}
      if (sourceSha) {
        checkedJobs(jobs, run, ['qualified-source-' + plan.digest, ...COMPONENTS.map(name => 'qualified-' + name + '-' + plan.components[name].digest)]);
        return {qualified:true, runId:run.id, attempt:run.run_attempt, sourceSha:run.head_sha, url:run.html_url, reuse:{}};
      }
      for (const name of COMPONENTS) {
        if (reuse[name]) continue;
        try {checkedJobs(jobs, run, ['qualified-' + name + '-' + plan.components[name].digest]);}
        catch {continue;}
        reuse[name] = {runId:run.id, attempt:run.run_attempt, sourceSha:run.head_sha, url:run.html_url};
      }
    }
    return {...fallback, reuse};
  } catch {
    // No partially verified result survives rate limits, timeouts, bad JSON,
    // missing pages, or unexpected provider responses.
    return fallback;
  }
}

export function localEntries(root = process.cwd()) {
  const rows = execFileSync('git', ['ls-files', '--stage', '-z'], {cwd:root, encoding:'utf8'}).split('\0').filter(Boolean);
  return rows.map(row => {
    const match = /^(100644|100755) [a-f0-9]{40} 0\t(.+)$/.exec(row);
    if (!match) throw Error('Symlink, submodule, unresolved merge or unsupported source entry');
    const [,mode,path] = match, info = lstatSync(resolve(root,path));
    if (!info.isFile() || info.isSymbolicLink() || ((info.mode & 0o111) !== 0) !== (mode === '100755')) throw Error('Source file mode/type changed');
    return {path, mode, sha:blob(readFileSync(resolve(root, path)))};
  });
}
export function localEnvironment(env = process.env) {
  const chrome = requireBrowser(env);
  return {node22:env.QUALIFICATION_NODE22, node24:env.QUALIFICATION_NODE24,
    browser:execFileSync(chrome, ['--version'], {encoding:'utf8'}).trim(), python:env.QUALIFICATION_PYTHON,
    platform:'ubuntu-24.04-x64', measurement:'full-isolated-serial-v1'};
}
export function declaredEnvironment(root = process.cwd(), env = process.env) {
  return {node22:env.QUALIFICATION_NODE22,node24:env.QUALIFICATION_NODE24,browser:BROWSER_IDENTITY,
    python:env.QUALIFICATION_PYTHON,platform:'ubuntu-24.04-x64',measurement:'full-isolated-serial-v1'};
}

export function localPlan(root = process.cwd(), env = process.env) {return makePlan(localEntries(root), localEnvironment(env));}
export function assertCurrent(plan, name, expected, env = process.env) {
  if (!COMPONENTS.includes(name) || !DIGEST.test(expected || '') || plan.components[name].digest !== expected) throw Error('Qualification inputs changed before or after execution');
  if (process.version !== plan.environment[name === 'owner24' ? 'node24' : 'node22']) throw Error('Qualification Node runtime changed');
  if (name === 'migration' && execFileSync('python',['--version'],{encoding:'utf8'}).trim() !== plan.environment.python) throw Error('Qualification Python runtime changed');
  for (const key of ['POWERAMP_LAYER_PICTURES_ONLY', 'POWERAMP_PLAYER_FILE', 'POWERAMP_HTML_FILE', 'POWERAMP_PLAYER_SOURCE', 'POWERAMP_PUBLIC_ROOT'])
    if (env[key]) throw Error('A shortened or overridden measurement/source plan cannot qualify');
  return true;
}

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, name] = process.argv.slice(2);
    if (command === 'plan') {
      const plan = makePlan(localEntries(root), declaredEnvironment(root)), proof = await findProof(plan, {currentRunId:process.env.GITHUB_RUN_ID});
      const matrix = COMPONENTS.map(component => ({component, digest:plan.components[component].digest,
        node:plan.environment[component === 'owner24' ? 'node24' : 'node22'].slice(1), reuse:!!proof.reuse[component], provenance:proof.reuse[component] || null}));
      writeFileSync('qualification-plan.json', JSON.stringify({...plan, proof}, null, 2) + '\n');
      if (!process.env.GITHUB_OUTPUT) throw Error('GitHub outputs required');
      appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\ndigest=${plan.digest}\nnode22=${plan.environment.node22.slice(1)}\nnode24=${plan.environment.node24.slice(1)}\npython=${plan.environment.python.slice(7)}\n`);
      console.log(JSON.stringify({digest:plan.digest, components:matrix.map(({component,reuse,provenance}) => ({component,reuse,provenance}))}));
    } else if (command === 'run' && COMPONENTS.includes(name)) {
      const plan = localPlan(root), expected = process.env.QUALIFICATION_COMPONENT_DIGEST;
      assertCurrent(plan, name, expected);
      if (process.env.QUALIFICATION_REUSE !== 'true') {
        let commands;
        if (name === 'migration') commands = [['python', ['-m', 'py_compile', 'scripts/migrate-drive-to-r2.py']], ['python', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_r2*.py', '-v']]];
        else if (name === 'performance') commands = performance.map(path => [process.execPath, ['--test', path]]);
        else commands = [[process.execPath, ['--test', ...plan.components[name].tests]]];
        let failed = false;
        for (const [binary, args] of commands) {
          const result = spawnSync(binary, args, {cwd:root, env:{...process.env, ...(name === 'owner24' ? {REQUIRE_RELAY_OWNER_BROWSER:'1', CHROMIUM_PATH:process.env.JARVIS_CHROME, PLAYWRIGHT_CHROMIUM_EXECUTABLE:process.env.JARVIS_CHROME} : {}), POWERAMP_BASELINE_REF:BASELINES[1]}, stdio:'inherit'});
          if (result.error || result.status !== 0) failed = true;
        }
        if (failed) throw Error('Required qualification component failed');
      }
      assertCurrent(localPlan(root), name, expected);
      writeFileSync('qualification-' + name + '.json', JSON.stringify({schema:1, component:name, digest:expected,
        outcome:process.env.QUALIFICATION_REUSE === 'true' ? 'verified-reused' : 'freshly-executed', provenance:process.env.QUALIFICATION_PROVENANCE || null}) + '\n');
    } else if (command === 'source-proof') {
      const plan = localPlan(root), sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:root, encoding:'utf8'}).trim();
      const proof = await findProof(plan, {sourceSha});
      writeFileSync('source-qualification-proof.json', JSON.stringify({...proof, digest:plan.digest, sourceSha}, null, 2) + '\n');
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'qualified=' + proof.qualified + '\n');
      console.log(JSON.stringify(proof));
    } else throw Error('Use plan, run <component>, or source-proof');
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
