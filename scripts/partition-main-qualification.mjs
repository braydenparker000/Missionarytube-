import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyCompletedDeployQualification } from './verify-main-qualification-producer.mjs';

// A reviewed copy of the existing privileged Deploy trigger, never a new one.
// Any filter or recipe change must keep full CI until separately reviewed here.
export const DEPLOY_PATHS = Object.freeze([
  'jarvis-release.json',
  'scripts/*jarvis*.mjs',
  'scripts/static-publication.mjs',
  'scripts/static-release-loader.js',
  'scripts/azure-static-store.mjs',
  'scripts/release-recovery-plan.mjs',
  'scripts/rollback-pair-proof.mjs',
  'scripts/rollback-pair-contracts.mjs',
  'scripts/rollback-pair-runtime.mjs',
  'scripts/r2-player-config.mjs',
  'tests/**',
  '*.html',
  'assets/**',
  'src/**',
  'scripts/build.mjs',
  'package.json',
  'package-lock.json',
  '.github/workflows/deploy-azure-storage.yml',
]);

// Deliberately below the current documented 3,000-file Actions limit and also
// at most the older 300-file limit. Larger pushes keep both qualification calls.
export const MAX_DEPLOY_ONLY_PATHS = 300;
export const GATE_RECIPE_SHA256 = Object.freeze({
  '.github/workflows/deploy-azure-storage.yml': '053b61a5ef45243142ec3b7f85c5a688093b6f538b5237c71595c4be0b6bca83',
  '.github/workflows/qualify-jarvis.yml': '848207d3f399fd8d4d5403bd5bde4be8b68c75d70b08f6499e609ff29c4c4d54',
});
const expectedTrigger = 'on:\n  workflow_dispatch:\n  push:\n    branches:\n      - main\n    paths:\n'
  + DEPLOY_PATHS.map(pattern => `      - "${pattern}"\n`).join('');

export function recognizedDeployTrigger(workflow) {
  if (typeof workflow !== 'string' || (workflow.match(/^on:/gm) || []).length !== 1) return false;
  // Reject unknown/duplicate top-level keys instead of trying to interpret all
  // equivalent YAML key spellings, tags, escapes, aliases or directives.
  const topLevel = workflow.split('\n').filter(line => line && !/^[ #]/u.test(line));
  if (topLevel.length !== 5 || !/^name: [^\r\n]+$/u.test(topLevel[0])
      || topLevel.slice(1).join('\n') !== 'on:\npermissions:\nconcurrency:\njobs:') return false;
  const match = /^on:\n[\s\S]*?(?=^\S|(?![\s\S]))/m.exec(workflow);
  // This is an exact known YAML block check, not a general-purpose YAML parser.
  // Alternate syntax, aliases, negations, additional events or filters fail closed.
  return match?.[0].replace(/\n+$/, '\n') === expectedTrigger;
}

export function recognizedGatingRecipes(deploy, qualification) {
  const hash = value => typeof value === 'string' ? createHash('sha256').update(value).digest('hex') : '';
  return hash(deploy) === GATE_RECIPE_SHA256['.github/workflows/deploy-azure-storage.yml']
    && hash(qualification) === GATE_RECIPE_SHA256['.github/workflows/qualify-jarvis.yml'];
}

export function matchesDeployPath(path) {
  if (typeof path !== 'string' || !path || /[\x00-\x1f\x7f\\]/u.test(path)
      || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) return false;
  return DEPLOY_PATHS.some(pattern => {
    const expression = pattern.split(/(\*\*|\*)/u).map(part => part === '**' ? '[\\s\\S]*'
      : part === '*' ? '[^/]*' : part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('');
    return new RegExp(`^${expression}$`, 'u').test(path);
  });
}

export function changesGateRecipe(path) {
  // Ordinary regression files are discovered by the identical complete npm
  // test in both callers; they do not select or suppress qualification lanes.
  if (/^tests\/[^/]+\.test\.mjs$/u.test(path)) return false;
  // This reviewed read-only timing collector is not used by either gate's
  // execution recipe. Its regressions still run in Deploy's complete npm test.
  if (path === 'scripts/jarvis-release-latency.mjs') return false;
  // Harnesses, browser runners, unknown/nested test shapes, other scripts and
  // dependency declarations can change selection/execution; retain full CI.
  return path.startsWith('.github/') || path.startsWith('scripts/') || path.startsWith('tests/')
    || path === 'package.json' || path === 'package-lock.json';
}

const full = reason => ({ deployOnly: false, owner: 'Validate', reason });
export function classifyMainPush({ eventName, event, headSha, root = process.cwd() }, overrides = {}) {
  try {
    if (eventName !== 'push') return full('event-requires-full-qualification');
    if (event?.ref !== 'refs/heads/main' || event?.repository?.full_name !== 'braydenparker000/Missionarytube-')
      return full('unrecognized-push-target');
    if (event.created !== false || event.deleted !== false || event.forced !== false)
      return full('new-deleted-forced-or-inconclusive-push');
    if (!/^[a-f0-9]{40}$/u.test(event.before || '') || /^0+$/u.test(event.before)
        || !/^[a-f0-9]{40}$/u.test(event.after || '') || event.after !== headSha)
      return full('inconclusive-push-identity');
    const git = overrides.git || (args => new TextDecoder('utf-8', { fatal: true }).decode(
      execFileSync('git', ['-C', root, ...args], {
        timeout: 10_000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      })));
    if (git(['rev-parse', 'HEAD']).trim() !== headSha) return full('checkout-identity-mismatch');
    git(['cat-file', '-e', `${event.before}^{commit}`]);
    git(['cat-file', '-e', `${event.after}^{commit}`]);
    git(['merge-base', '--is-ancestor', event.before, event.after]);
    const count = git(['rev-list', '--count', `${event.before}..${event.after}`]).trim();
    if (!/^[1-9][0-9]*$/u.test(count) || Number(count) > 1000) return full('empty-or-large-commit-history');
    const output = git(['diff', '--name-only', '--no-renames', '-z', event.before, event.after, '--']);
    if (!output) return full('empty-or-zero-net-diff');
    if (!output.endsWith('\0')) return full('incomplete-changed-path-list');
    const paths = output.slice(0, -1).split('\0');
    if (paths.length > MAX_DEPLOY_ONLY_PATHS) return full('large-diff-keeps-full-qualification');
    if (new Set(paths).size !== paths.length || paths.some(path => !matchesDeployPath(path)))
      return full('mixed-unknown-or-unsupported-path');
    if (paths.some(changesGateRecipe)) return full('qualification-recipe-change');
    const workflow = overrides.workflow ?? readFileSync(resolve(root, '.github/workflows/deploy-azure-storage.yml'), 'utf8');
    if (!recognizedDeployTrigger(workflow)) return full('unrecognized-deploy-trigger');
    const qualification = overrides.qualificationWorkflow
      ?? readFileSync(resolve(root, '.github/workflows/qualify-jarvis.yml'), 'utf8');
    if (!recognizedGatingRecipes(workflow, qualification)) return full('unrecognized-gating-recipe');
    return { deployOnly: true, owner: 'Deploy to Azure Storage', reason: 'bounded-unchanged-recipe-deploy-only-push' };
  } catch {
    // Missing history, nonancestor pushes, Git failures/timeouts and unreadable
    // workflow definitions are lack of proof, never permission to skip a gate.
    return full('inconclusive-local-history-or-workflow');
  }
}

export async function selectQualificationOwner(input, overrides = {}) {
  const candidate = classifyMainPush(input, overrides);
  if (!candidate.deployOnly) return { ...candidate, qualificationVerified: false };
  const proof = await verifyCompletedDeployQualification(input.headSha, overrides);
  if (!proof.verified) return { ...full(proof.reason), qualificationVerified: false };
  return { ...candidate, reason: 'verified-existing-exact-qualification', qualificationVerified: true,
    producerRunId: proof.runId, producerAttempt: proof.attempt, qualificationCompletedAt: proof.qualificationCompletedAt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let result;
  try {
    result = await selectQualificationOwner({ eventName: process.env.GITHUB_EVENT_NAME,
      event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')), headSha: process.env.GITHUB_SHA });
  } catch { result = { ...full('unreadable-push-event-or-proof'), qualificationVerified: false }; }
  if (!process.env.GITHUB_OUTPUT) throw Error('GITHUB_OUTPUT is required; no delegation output was published');
  appendFileSync(process.env.GITHUB_OUTPUT, `deploy_only=${result.deployOnly}\nqualification_verified=${result.qualificationVerified}\n`);
  const message = `Qualification owner: ${result.owner}; ${result.reason}`;
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `${message}\n\n${result.deployOnly
      ? `Verified completed-success qualification in exact Deploy run ${result.producerRunId}, attempt ${result.producerAttempt}. This is qualification evidence only; no live or production deployment success is claimed.\n`
      : 'Validate retains its complete reusable qualification pipeline.\n'}`);
}
