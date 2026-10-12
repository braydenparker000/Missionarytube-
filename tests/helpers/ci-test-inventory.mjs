import {accessSync, constants, readdirSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// Each former npm-test file has exactly one owner in the aggregate workflow.
// New .test.js files default to regressions; Relay files enter fast feedback.
export const dedicated = ['tests/poweramp-blank-library-browser.test.js', 'tests/podcasts-browser.test.js'];
export const relayContracts = ['tests/ci-workflow.test.js', 'tests/oauth-consent-browser.test.js',
  'tests/shared.test.js', 'tests/publications.test.js', 'tests/origins.test.js', 'tests/hub.test.js'];
export const performance = ['tests/poweramp-render-trace-browser.mjs',
  'tests/poweramp-persistent-prototype-browser.mjs', 'tests/poweramp-preview-setup-browser.mjs', 'tests/poweramp-shuffle-latency-browser.mjs'];

export function inventory(files) {
  const all = [...files].sort();
  if (new Set(all).size !== all.length) throw Error('Duplicate aggregate test file');
  for (const path of [...dedicated, ...relayContracts]) {
    if (!all.includes(path)) throw Error('Missing required aggregate test: ' + path);
  }
  const relay = all.filter(path => relayContracts.includes(path) || /^tests\/relay-.*\.test\.js$/.test(path));
  const regressions = all.filter(path => !dedicated.includes(path) && !relay.includes(path));
  const groups = {relay, regressions, blankLibrary: [dedicated[0]], podcasts: [dedicated[1]]};
  const assigned = Object.values(groups).flat();
  if (assigned.length !== all.length || new Set(assigned).size !== all.length ||
      all.some(path => !assigned.includes(path))) throw Error('Aggregate inventory must cover every test exactly once');
  return {groups, aggregate: all, performance};
}

export function requireBrowser(env = process.env) {
  const path = env.JARVIS_CHROME;
  if (!path || !path.startsWith('/')) throw Error('JARVIS_CHROME must name an executable Chromium binary; browser coverage cannot skip');
  try {
    if (!statSync(path).isFile()) throw Error('not a file');
    accessSync(path, constants.X_OK);
  } catch {
    throw Error('JARVIS_CHROME is not an executable file; browser coverage cannot skip');
  }
  return path;
}

export function auditWorkflows(source, owner) {
  const count = (text, value) => text.split(value).length - 1;
  if (count(source, 'node scripts/qualification-proof.mjs plan') !== 1 ||
      count(source, 'node scripts/qualification-proof.mjs run "${{ matrix.component }}"') !== 1)
    throw Error('Preserve exactly one complete qualification planner and component execution owner');
  if (!source.includes('include: ${{ fromJSON(needs.plan.outputs.matrix) }}') ||
      !source.includes('fail-fast: false')) throw Error('Every inventoried component must have an independent non-cancelling lane');
  if (!source.includes('needs: [plan, component]') || !source.includes('test "$PLAN_RESULT" = success') ||
      !source.includes('test "$COMPONENT_RESULT" = success') || /continue-on-error/.test(source))
    throw Error('Full qualification requires every gate, including rejected/failed/skipped outcomes');
  if (count(source, 'test -x "$JARVIS_CHROME"') !== 2 || source.includes('POWERAMP_LAYER_PICTURES_ONLY'))
    throw Error('Preserve mandatory Chromium and the full serial performance plan');
  if (count(source, 'if: always()') !== 1 || count(source, 'retention-days: 14') !== 2)
    throw Error('Preserve always-uploaded component browser/provenance artifacts and retention');
  if (!owner.includes("- 'tests/oauth-consent-browser.test.js'"))
    throw Error('OAuth browser changes must trigger fast Relay validation');
  if (!owner.includes('node tests/helpers/ci-test-inventory.mjs run relay --require-browser'))
    throw Error('Fast Relay validation must include the OAuth browser contract');
  if (!owner.includes("REQUIRE_RELAY_OWNER_BROWSER: '1'")) throw Error('Owner browser coverage must remain mandatory');
  for (const workflow of [source, owner]) {
    if (!workflow.includes("cancel-in-progress: ${{ github.event_name == 'pull_request' }}") ||
        !workflow.includes("${{ github.event_name == 'pull_request' && github.ref || github.run_id }}"))
      throw Error('Cancel only superseded pull-request validation, with unique non-PR groups');
  }
  return true;
}

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const coverage = inventory(readdirSync(resolve(root, 'tests')).filter(path => path.endsWith('.test.js')).map(path => 'tests/' + path));
    const [command, group, browser] = process.argv.slice(2);
    if (command === 'check') {
      for (const path of performance) accessSync(resolve(root, path), constants.R_OK);
      console.log(JSON.stringify(coverage, null, 2));
    } else if (command === 'run' && Object.hasOwn(coverage.groups, group) && browser === '--require-browser') {
      requireBrowser();
      console.log('Executing ' + group + ': ' + coverage.groups[group].join(', '));
      const result = spawnSync(process.execPath, ['--test', ...coverage.groups[group]], {cwd: root, env: process.env, stdio: 'inherit'});
      if (result.error) throw result.error;
      process.exitCode = result.status ?? 1;
    } else throw Error('Use check or run <group> --require-browser');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
