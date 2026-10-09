import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,symlink,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readTree,buildPublication,savePublication,sha256} from '../scripts/static-publication.mjs';
import {schemaAt} from '../scripts/rollback-pair-contracts.mjs';
import {runPairRuntime} from '../scripts/rollback-pair-runtime.mjs';

const execute=promisify(execFile);
test('the exact built artifact preserves Jarvis owner isolation, Poweramp/Astra, lazy decoder paths, history, CSP and storage across release selection', {timeout:180000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'actual-release-runtime-')),repository=resolve('.'),source=join(repository,'.jarvis-source');
  try{
    const release=JSON.parse(await readFile(join(repository,'jarvis-release.json'),'utf8'));
    await mkdir(join(root,'scripts'));for(const name of ['build-jarvis.mjs','r2-player-config.mjs'])await copyFile(join(repository,'scripts',name),join(root,'scripts',name));
    await writeFile(join(root,'jarvis-release.json'),JSON.stringify(release));await symlink(source,join(root,'.jarvis-source'),'dir');
    // Exercise the committed Storage build, including its route-specific CSP;
    // no simplified HTML or reconstructed application substitutes for the artifact.
    await execute(process.execPath,['scripts/build-jarvis.mjs'],{cwd:root,timeout:30000,maxBuffer:1024*1024});
    const input=await readTree(join(root,'dist')),loader=await readFile(join(repository,'scripts/static-release-loader.js'));
    for(const name of ['previous','candidate'])await savePublication(buildPublication(input,{proof:{source:release.commit,fixture:name},loader,recipe:sha256('actual locked artifact fixture')}),join(root,name));
    const rows=await schemaAt(source,release.commit);for(const name of ['live','candidate'])await writeFile(join(root,name+'-schema.sql'),rows.map(row=>row.sql).join('\n'));
    const chrome=process.env.JARVIS_CHROME||(await execute('sh',['-c','command -v google-chrome || command -v chromium'])).stdout.trim();
    const result=await runPairRuntime({source,previousDirectory:join(root,'previous'),candidateDirectory:join(root,'candidate'),schemaDirectory:root,chrome});
    assert.equal(result.previousFrontendRendered,true);assert.equal(result.privatePublicBoundaryPreserved,true);assert.equal(result.pendingRowsPreserved,4);
    assert.equal(result.unexpectedNetworkRequests,0);assert.equal(result.productionOperations,0);assert.ok(result.browserRequests<=500);
  }finally{await rm(root,{recursive:true,force:true});}
});
