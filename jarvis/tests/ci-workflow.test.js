import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {inventory, requireBrowser, auditWorkflows, dedicated, performance} from './helpers/ci-test-inventory.mjs';

const files = readdirSync(new URL('./', import.meta.url)).filter(path => path.endsWith('.test.js')).map(path => 'tests/' + path);
const source = readFileSync(new URL('../.github/workflows/validate-r2.yml', import.meta.url), 'utf8');
const owner = readFileSync(new URL('../.github/workflows/validate-relay-owner.yml', import.meta.url), 'utf8');

test('aggregate inventory preserves every legacy npm-test file exactly once', () => {
  const result = inventory(files), assigned = Object.values(result.groups).flat();
  assert.deepEqual([...assigned].sort(), [...files].sort());
  assert.equal(new Set(assigned).size, files.length);
  assert.deepEqual(result.groups.blankLibrary, [dedicated[0]]);
  assert.deepEqual(result.groups.podcasts, [dedicated[1]]);
  assert.ok(result.groups.relay.includes('tests/oauth-consent-browser.test.js'));
  assert.ok(result.groups.relay.includes('tests/relay-owner-browser.test.js'));
  assert.deepEqual(result.performance, performance);
});

test('new tests enter aggregate coverage, and new Relay contracts enter fast feedback', () => {
  const result = inventory([...files, 'tests/future.test.js', 'tests/relay-future.test.js']);
  assert.ok(result.groups.regressions.includes('tests/future.test.js'));
  assert.ok(result.groups.relay.includes('tests/relay-future.test.js'));
});

test('inventory rejects duplicate or missing mandatory browser coverage', () => {
  assert.throws(() => inventory([...files, files[0]]), /Duplicate/);
  for (const path of [...dedicated, 'tests/oauth-consent-browser.test.js'])
    assert.throws(() => inventory(files.filter(file => file !== path)), /Missing required aggregate test/);
});

test('missing Chromium fails before a test group can silently skip', () => {
  assert.throws(() => requireBrowser({}), /cannot skip/);
  assert.throws(() => requireBrowser({JARVIS_CHROME: '/nonexistent/ci-chromium'}), /cannot skip/);
  assert.throws(() => requireBrowser({JARVIS_CHROME: '/tmp'}), /cannot skip/);
  assert.throws(() => requireBrowser({JARVIS_CHROME: 'chromium'}), /cannot skip/);
});

test('workflows retain full coverage, serial performance gates and fast OAuth browsers', () => {
  assert.equal(auditWorkflows(source, owner), true);
});

test('fast owner feedback uses the same qualified Node and browser as the release', () => {
  assert.ok(owner.includes("node-version: '24.21.0'"));
  assert.ok(owner.includes('node scripts/install-qualification-browser.mjs'));
  assert.ok(owner.includes('jarvis-browser-linux64-154.0.8037.97-487c3b0e89f786d9257a6265a29bacf18b893e90f29c0ef6f7be9706ecc8c7a2'));
  assert.ok(!owner.includes('playwright-core install'));
  assert.ok(owner.includes("- 'public/muse/**'"));
});

test('workflow audit rejects incomplete, browser-optional and weakened qualification', () => {
  const command = 'node scripts/qualification-proof.mjs plan';
  assert.throws(() => auditWorkflows(source + '\n' + command, owner), /exactly one/);
  assert.throws(() => auditWorkflows(source.replace(command, ''), owner), /exactly one/);
  assert.throws(() => auditWorkflows(source.replace('test -x "$JARVIS_CHROME"', ''), owner), /mandatory Chromium/);
  assert.throws(() => auditWorkflows(source.replace('fail-fast: false', 'fail-fast: true'), owner), /non-cancelling/);
  assert.throws(() => auditWorkflows(source.replace('test "$COMPONENT_RESULT" = success', ''), owner), /every gate/);
  assert.throws(() => auditWorkflows(source + '\ncontinue-on-error: true', owner), /every gate/);
  assert.throws(() => auditWorkflows(source.replace('retention-days: 14', ''), owner), /retention/);
  assert.throws(() => auditWorkflows(source, owner.replace("cancel-in-progress: ${{ github.event_name == 'pull_request' }}", 'cancel-in-progress: true')), /pull-request/);
  assert.throws(() => auditWorkflows(source, owner.replace("REQUIRE_RELAY_OWNER_BROWSER: '1'", '')), /mandatory/);
});
