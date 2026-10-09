import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {schemaAt} from '../scripts/rollback-pair-contracts.mjs';
test('native populated SQLite migration survives every committed DDL interruption and preserves pending/accepted work',()=>{
  const script=fileURLToPath(new URL('./fixtures/release-recovery/schema-recovery.py',import.meta.url));
  const result=JSON.parse(execFileSync('python3',[script],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}));
  assert.equal(result.ddlInterruptionPoints,47);assert.equal(result.pendingRowsPreserved,4);
  assert.equal(result.runningLeasePreserved,true);assert.equal(result.immutableReplyPreserved,true);
  assert.equal(result.sqliteRestoreLossWindowDemonstrated,true);assert.equal(result.providerRestoreVerified,false);
});
test('committed c4/PR73 schema fixtures include every literal statement, including the conditional unique result-version index',async()=>{
  const normalize=sql=>sql.replace(/\s+/g,' ').trim();
  for(const [name,commit] of [['live','c4d62409a3b67e4e5dac88809c6a4a0290b6e39e'],['candidate','ea9c09c1ddb172c1f0d668b58a5e7066f1c8318f']]){
    const rows=await schemaAt(resolve('.jarvis-source'),commit),text=await readFile(new URL('./fixtures/release-recovery/'+name+'-schema.sql',import.meta.url),'utf8');
    const fixture=text.replace(/^--.*$/gm,'').split(';').map(sql=>sql.trim()).filter(Boolean).map(sql=>normalize(sql+';'));
    assert.deepEqual(fixture,rows.map(row=>normalize(row.sql)),name+' immutable literal schema');
  }
});
