import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha1 = /^[a-f0-9]{40}$/;
const sha256 = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function requireValue(ok, message) { if (!ok) throw new Error(message); }
function paths(items, label) {
  requireValue(Array.isArray(items) && items.length > 0, `${label}: nonempty array required`);
  const seen = new Set();
  for (const item of items) {
    requireValue(typeof item?.path === 'string' && /^(?:assets|private|muse|mast)\/[a-zA-Z0-9._/-]+$/.test(item.path)
      && !item.path.split('/').some(p => !p || p === '.' || p === '..'), `${label}: unsafe path`);
    requireValue(sha256.test(item.sha256), `${label}: SHA256 required`);
    requireValue(!seen.has(item.path), `${label}: duplicate path ${item.path}`);
    seen.add(item.path);
  }
  return seen;
}

// Pure validation. This module performs no fetch, environment lookup, process spawn or write.
// Optional observations must be supplied by a separate authorized read-only process.
export function validateInventory(inventory, observed) {
  requireValue(inventory?.schema === 1 && inventory.kind === 'historical-release-inventory', 'inventory schema/kind invalid');
  requireValue(typeof inventory.observedAt === 'string' && Number.isFinite(Date.parse(inventory.observedAt)), 'observation timestamp required');
  const { deployment: d, source: s, components: c } = inventory;
  requireValue(d?.repository === 'braydenparker000/Missionarytube-' && d.repositoryId === 1350047370, 'canonical deployment repository mismatch');
  requireValue(sha1.test(d.commit) && sha1.test(d.tree), 'deployment commit/tree required');
  requireValue(s?.repository === 'braydenparker999/jarvis' && sha1.test(s.qualifiedCommit) && sha1.test(s.mergedCommit) && sha1.test(s.tree), 'source proof identity required');
  requireValue(c && Object.keys(c).sort().join(',') === 'legacyGeneralRecipe,privateFrontend,worker', 'component ownership incomplete or ambiguous');
  const f = c.privateFrontend, w = c.worker, l = c.legacyGeneralRecipe;
  requireValue(f?.owner === 'publish-private-board' && w?.owner === 'jarvis-hub-api' && l?.owner === 'jarvis-release.json consumers', 'component owner mismatch');
  requireValue(f.source === s.qualifiedCommit && sha1.test(w.source) && sha1.test(l.source), 'component source identity mismatch');
  requireValue(l.status === 'recipe-only-not-complete-live-baseline', 'legacy recipe must not claim complete production coverage');
  requireValue(f.receiptUrl === 'https://missionarytube.z13.web.core.windows.net/private-workspace-release.json' && sha256.test(f.receiptSha256) && /^\d+$/.test(f.runId), 'frontend receipt/proof identity required');
  requireValue(uuid.test(w.version) && ['codeSha256', 'settingsDigest', 'schedulesDigest'].every(k => sha256.test(w[k])), 'Worker identity incomplete');
  const assets = paths(f.assets, 'assets'), dependencies = paths(f.preservedDependencies, 'dependencies');
  requireValue([...assets].every(p => !dependencies.has(p)), 'changed assets overlap preserved dependencies');
  requireValue(typeof inventory.coverage === 'string' && inventory.coverage.length > 0, 'coverage limitation required');
  if (observed !== undefined) {
    requireValue(observed?.deploymentCommit === d.commit && observed.source === f.source && observed.receiptSha256 === f.receiptSha256, 'observed release identity differs from inventory');
    requireValue(['version', 'codeSha256', 'settingsDigest', 'schedulesDigest'].every(k => observed.worker?.[k] === w[k]), 'observed Worker identity differs from inventory');
    const expected = new Map([...f.assets, ...f.preservedDependencies].map(x => [x.path, x.sha256]));
    paths(observed.files, 'observed files');
    requireValue(observed.files.length === expected.size && observed.files.every(x => expected.get(x.path) === x.sha256), 'observed dependency closure differs from inventory');
  }
  return { valid: true, liveVerified: false, suppliedObservationMatches: observed !== undefined, assets: assets.size, preservedDependencies: dependencies.size };
}

export async function main(args) {
  requireValue(args.length === 1 || args.length === 2, 'usage: node scripts/check-release-inventory.mjs INVENTORY.json [READ_ONLY_OBSERVATION.json]');
  const inventory = JSON.parse(await readFile(args[0], 'utf8'));
  const observed = args[1] === undefined ? undefined : JSON.parse(await readFile(args[1], 'utf8'));
  return validateInventory(inventory, observed);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}
