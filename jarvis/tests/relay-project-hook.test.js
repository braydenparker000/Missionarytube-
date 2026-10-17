import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('deterministic Bash-invoked Python adapter: durable deduplication and recovery', () => {
  const result = spawnSync('python3', [fileURLToPath(new URL('./helpers/project-hook-tests.py', import.meta.url))], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran \d+ tests/);
});
