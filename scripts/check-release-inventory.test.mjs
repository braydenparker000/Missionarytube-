import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateInventory, main } from './check-release-inventory.mjs';

const file = new URL('../release-inventory.json', import.meta.url);
const baseline = JSON.parse(await readFile(file, 'utf8'));
const copy = () => structuredClone(baseline);
const observation = () => ({ deploymentCommit: baseline.deployment.commit,
  source: baseline.source.qualifiedCommit, receiptSha256: baseline.components.privateFrontend.receiptSha256,
  worker: structuredClone(baseline.components.worker),
  files: structuredClone([...baseline.components.privateFrontend.assets, ...baseline.components.privateFrontend.preservedDependencies]) });
test('historical inventory validates without claiming a live check', () => {
  assert.deepEqual(validateInventory(copy()), { valid: true, liveVerified: false, suppliedObservationMatches: false, assets: 18, preservedDependencies: 45 });
});
test('supplied complete observation matches without claiming freshness', () => {
  const result = validateInventory(copy(), observation());
  assert.equal(result.suppliedObservationMatches, true); assert.equal(result.liveVerified, false);
});
for (const [name, mutate, expected] of [
  ['old alias', x => x.deployment.repository = 'braydenparker999/Missionarytube-', /canonical/],
  ['wrong repository ID', x => x.deployment.repositoryId = 1, /canonical/],
  ['missing proof SHA', x => delete x.source.qualifiedCommit, /proof/],
  ['source mismatch', x => x.components.privateFrontend.source = '0'.repeat(40), /source identity/],
  ['extra component', x => x.components.other = {}, /ambiguous/],
  ['owner mismatch', x => x.components.worker.owner = 'publish-private-board', /owner/],
  ['legacy masquerading as live', x => x.components.legacyGeneralRecipe.status = 'live', /legacy/],
  ['overlap', x => x.components.privateFrontend.preservedDependencies.push(x.components.privateFrontend.assets[0]), /overlap/],
  ['duplicate asset', x => x.components.privateFrontend.assets.push(x.components.privateFrontend.assets[0]), /duplicate/],
  ['traversal path', x => x.components.privateFrontend.assets[0].path = 'assets/../secret', /unsafe/],
  ['absolute path', x => x.components.privateFrontend.assets[0].path = '/tmp/file', /unsafe/],
  ['invalid hash', x => x.components.privateFrontend.assets[0].sha256 = 'bad', /SHA256/],
  ['missing Worker digest', x => delete x.components.worker.settingsDigest, /Worker/],
  ['receipt URL credentials', x => x.components.privateFrontend.receiptUrl = 'https://user:password@example.com', /receipt/],
]) test(`reject ${name}`, () => { const x = copy(); mutate(x); assert.throws(() => validateInventory(x), expected); });
for (const key of ['deploymentCommit', 'source', 'receiptSha256']) test(`reject stale observed ${key}`, () => {
  const o = observation(); o[key] = '0'.repeat(64); assert.throws(() => validateInventory(copy(), o), /release identity/);
});
for (const key of ['version', 'codeSha256', 'settingsDigest', 'schedulesDigest']) test(`reject stale observed Worker ${key}`, () => {
  const o = observation(); o.worker[key] = 'stale'; assert.throws(() => validateInventory(copy(), o), /Worker identity/);
});
test('reject missing or changed observed dependency', () => {
  const o = observation(); o.files.pop(); assert.throws(() => validateInventory(copy(), o), /closure/);
  const p = observation(); p.files[0].sha256 = '0'.repeat(64); assert.throws(() => validateInventory(copy(), p), /closure/);
});
test('reject malformed input', () => assert.throws(() => validateInventory(null), /schema/));
test('CLI requires explicit local inventory path', async () => {
  await assert.rejects(main([]), /usage/); await assert.rejects(main(['a', 'b', 'c']), /usage/);
  assert.equal((await main([file])).assets, 18);
});
