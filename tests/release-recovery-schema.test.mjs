import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('native populated SQLite migration survives every committed DDL interruption and preserves pending/accepted work',()=>{
  const script=fileURLToPath(new URL('./fixtures/release-recovery/schema-recovery.py',import.meta.url));
  const result=JSON.parse(execFileSync('python3',[script],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}));
  assert.equal(result.ddlInterruptionPoints,46);assert.equal(result.pendingRowsPreserved,4);
  assert.equal(result.runningLeasePreserved,true);assert.equal(result.immutableReplyPreserved,true);
  assert.equal(result.sqliteRestoreLossWindowDemonstrated,true);assert.equal(result.providerRestoreVerified,false);
});
