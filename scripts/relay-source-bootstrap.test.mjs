import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';

test('every pinned-source aggregate test job installs its own locked dependencies first', async () => {
  const dir = new URL('../.github/workflows/',import.meta.url);
  let aggregateJobs = 0;
  for (const file of await readdir(dir)) {
    if (!file.endsWith('.yml')) continue;
    const source = await readFile(new URL(file,dir),'utf8');
    // Jobs have two-space names in these workflows; split so an install on a
    // different runner cannot satisfy the job that executes test:jarvis.
    for (const job of source.slice(source.indexOf('\njobs:')).split(/\n  [A-Za-z0-9_-]+:\n/).slice(1)) {
      const aggregate = job.indexOf('run: npm run test:jarvis');
      if (aggregate === -1) continue;
      aggregateJobs++;
      const checkout = job.indexOf('path: .jarvis-source');
      const install = job.indexOf('run: npm --prefix .jarvis-source ci');
      assert.ok(checkout !== -1 && checkout < install && install < aggregate,
        `${file}: pinned-source checkout and locked install must precede test:jarvis in the same job`);
      assert.doesNotMatch(job.slice(install,aggregate),/--ignore-scripts|--omit(?:=|\s)|NODE_ENV:\s*production/);
    }
  }
  assert.equal(aggregateJobs,2,'Both Validate and Azure frontend promotion must retain the complete source test suite');
});
