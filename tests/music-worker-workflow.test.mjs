import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {musicWorkerConfig} from '../scripts/prepare-music-worker.mjs';

const base = () => ({name:'jarvis-hub-api',main:'worker.js',compatibility_date:'2026-09-19',workers_dev:true,
  durable_objects:{bindings:[{name:'HUBS',class_name:'Hub'}]},migrations:[{tag:'v1',new_sqlite_classes:['Hub']}],
  observability:{enabled:false},vars:{EXISTING:'preserved'}});
test('candidate preserves the existing Worker and adds only the designated music binding',()=>{
  const input=base(),candidate=musicWorkerConfig(input);
  assert.deepEqual(candidate.durable_objects,input.durable_objects);
  assert.deepEqual(candidate.migrations,input.migrations);
  assert.deepEqual(candidate.observability,input.observability);
  assert.equal(candidate.vars.EXISTING,'preserved');
  assert.equal(candidate.vars.MUSIC_PUBLIC_READ,'true');
  assert.equal(candidate.vars.MUSIC_ROOT_ID,'1VlEUztloW5saoM7iF11fodDKSmCGP2ZZ');
  assert.equal(candidate.keep_vars,true);
  assert.deepEqual(candidate.r2_buckets,[{binding:'MUSIC_R2',bucket_name:'jarvis-music'}]);
  assert.equal(input.r2_buckets,undefined);
});
test('preparation is idempotent and preserves unrelated preexisting bindings',()=>{
  const input=base();input.r2_buckets=[{binding:'OTHER',bucket_name:'other'}];
  const first=musicWorkerConfig(input),second=musicWorkerConfig(first);
  assert.deepEqual(second,first);assert.equal(second.r2_buckets[0].binding,'OTHER');
});
test('wrong Worker, missing existing storage and conflicting bucket names fail closed',()=>{
  for(const input of [{...base(),name:'another-worker'},{...base(),main:'other.js'},{...base(),durable_objects:{}},
    {...base(),r2_buckets:[{binding:'MUSIC_R2',bucket_name:'wrong'}]}])assert.throws(()=>musicWorkerConfig(input));
});
test('deployment is manual, immutable, serialized and tested before scoped secret use',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/deploy-music-worker.yml',import.meta.url),'utf8');
  assert.match(workflow,/workflow_dispatch:/);
  assert.doesNotMatch(workflow,/\n  (?:push|schedule|pull_request):/);
  assert.match(workflow,/confirm_public_music == true/);
  assert.match(workflow,/\^\[a-f0-9\]\{40\}\$/);
  assert.match(workflow,/cancel-in-progress: false/);
  assert.ok(workflow.indexOf('npm --prefix .jarvis-source test')<workflow.indexOf('secrets.CLOUDFLARE_API_TOKEN'));
  assert.match(workflow,/secrets.R2_ACCOUNT_ID/);
  assert.doesNotMatch(workflow,/R2_SECRET_ACCESS_KEY|R2_ACCESS_KEY_ID/);
  assert.match(workflow,/versions list --name jarvis-hub-api --json/);
  assert.match(workflow,/persist-credentials: false/);
});
