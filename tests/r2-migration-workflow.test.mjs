import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow=readFileSync(new URL('../.github/workflows/migrate-music-r2.yml',import.meta.url),'utf8');

test('R2 transfers remain manual and serialized',()=>{
  assert.match(workflow,/if: \$\{\{ github\.event_name == 'workflow_dispatch' \}\}/);
  assert.match(workflow,/group: r2-music-migration\s+cancel-in-progress: false/);
  assert.match(workflow,/default: '5'/);
});

test('the transfer uses the exact source revision whose integrity tests passed',()=>{
  assert.match(workflow,/source_sha: \$\{\{ steps\.source\.outputs\.sha \}\}/);
  assert.match(workflow,/test -f \.jarvis-source\/tests\/test_r2_migration\.py/);
  assert.match(workflow,/python -m unittest discover -s \.jarvis-source\/tests -p 'test_r2_migration\.py' -v/);
  assert.match(workflow,/git -C \.jarvis-source rev-parse HEAD/);
  assert.match(workflow,/needs: validate/);
  assert.match(workflow,/ref: \$\{\{ needs\.validate\.outputs\.source_sha \}\}/);
});

test('manual inputs are passed through environment variables rather than shell interpolation',()=>{
  assert.match(workflow,/MIGRATION_LIMIT: \$\{\{ inputs\.limit \}\}/);
  assert.match(workflow,/MIGRATION_CONCURRENCY: \$\{\{ inputs\.concurrency \}\}/);
  assert.match(workflow,/--limit "\$MIGRATION_LIMIT"/);
  assert.match(workflow,/--concurrency "\$MIGRATION_CONCURRENCY"/);
  assert.doesNotMatch(workflow,/--(?:limit|concurrency) "\$\{\{/);
});

test('private cloning needs no public URL and never receives Azure deployment permissions',()=>{
  assert.match(workflow,/for name in GOOGLE_DRIVE_API_KEY R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do/);
  assert.doesNotMatch(workflow,/id-token: write|contents: write|r2 bucket create|--public/);
  assert.match(workflow,/Save migration report\s+if: always\(\)/);
});
