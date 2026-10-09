import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {rollbackPairCommand} from '../scripts/qualify-jarvis-rollback-pair.mjs';
import {schemaAt} from '../scripts/rollback-pair-contracts.mjs';
import {commandFixture,SYNTHETIC_EVIDENCE} from './fixtures/release-recovery/command-fixture.mjs';

test('the producer executes all checks in an isolated fixture and emits only their digest-bound bounded projections',async()=>{
  const f=await commandFixture();try{
    await f.prepare();const calls=[],runner=async(binary,args,options)=>{
      calls.push({binary,args,env:options.env});
      if(binary==='python3')return {stdout:JSON.stringify({schema:1,...SYNTHETIC_EVIDENCE.schema})};
      if(args[0]?.endsWith('/rollback-pair-runtime.mjs')){await writeFile(args[5],JSON.stringify(SYNTHETIC_EVIDENCE.runtime));return {stdout:''};}
      if(args[0]==='--test')return {stdout:'TAP version 13\n# tests 3\n# pass 3\n# fail 0\n# skipped 0\n'};
      return {stdout:''};
    };
    const opts={...f.opts,runner,runtimeVersion:'v24.21.0',env:{...f.env,JARVIS_CHROME:'/synthetic/chrome',QUICK_AI_GEMINI_KEY:'SYNTHETIC_PRIVATE_KEY',HTTP_PROXY:'SYNTHETIC_PROXY_CREDENTIAL'}};
    const result=await rollbackPairCommand('produce',opts),proof=JSON.parse(await readFile(join(f.root,'.publication/rollback-compatibility.json')));
    assert.equal(result.pairDigest,proof.pairDigest);assert.deepEqual(proof.record.evidence,SYNTHETIC_EVIDENCE);assert.equal(f.writes.length,0);
    const fixtures=calls.filter(call=>call.binary==='python3'||call.args[0]?.endsWith('/rollback-pair-runtime.mjs')||call.args[0]==='--test');assert.equal(fixtures.length,3);
    for(const call of fixtures){for(const key of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','QUICK_AI_GEMINI_KEY','HTTP_PROXY'])assert.equal(call.env[key],undefined,key);assert.ok(call.env.HOME.startsWith(join(f.root,'.publication/pair-fixture-')));}
    assert.equal(calls.filter(call=>call.args[0]==='scripts/worker-release-identity.mjs'&&call.args[1]==='verify-planned').length,2);
    assert.ok(calls.some(call=>call.args[0]?.endsWith('/scripts/verify-podcasts.mjs')));
    await assert.rejects(rollbackPairCommand('verify-local',opts),/immutable verification stamp/);
    assert.equal((await rollbackPairCommand('verify-local',{...opts,env:{...opts.env,EXPECTED_PAIR_DIGEST:proof.pairDigest}})).pairDigest,proof.pairDigest);
    assert.ok(!JSON.stringify(proof).includes('SYNTHETIC_PRIVATE_KEY'));
  }finally{await f.cleanup();}
});
test('schema/browser/adversarial/readiness failures never retain a new usable compatibility report or perform provider writes',async()=>{
  for(const failure of ['schema','browser','adversarial','readiness','identity','runtime']){
    const f=await commandFixture();try{
      await f.prepare();const path=join(f.root,'.publication/rollback-compatibility.json');await rm(path);
      const runner=async(binary,args)=>{
        if(failure==='identity'&&args[0]==='scripts/worker-release-identity.mjs')throw Error('synthetic failed identity');
        if(binary==='python3'){if(failure==='schema')throw Error('synthetic schema');return {stdout:JSON.stringify({schema:1,...SYNTHETIC_EVIDENCE.schema})};}
        if(args[0]?.endsWith('/rollback-pair-runtime.mjs')){if(failure==='browser')throw Error('synthetic browser');await writeFile(args[5],JSON.stringify(SYNTHETIC_EVIDENCE.runtime));return {stdout:''};}
        if(args[0]==='--test')return {stdout:'# fail '+(failure==='adversarial'?1:0)+'\n# skipped 0\n'};
        if(failure==='readiness'&&args[0]?.endsWith('/scripts/verify-podcasts.mjs'))throw Error('synthetic readiness');return {stdout:''};
      };
      await assert.rejects(rollbackPairCommand('produce',{...f.opts,runner,runtimeVersion:failure==='runtime'?'v24.20.0':'v24.21.0',env:{...f.env,JARVIS_CHROME:'/synthetic/chrome'}}));
      await assert.rejects(readFile(path),error=>error.code==='ENOENT');assert.equal(f.writes.length,0);
    }finally{await f.cleanup();}
  }
});
test('prewrite provider authorization requires the independently completed producer and a fresh exact full static baseline',async()=>{
  for(const change of ['none','missing','producer','attempt','settings','bytes','etag','added','mode']){
    const f=await commandFixture();try{
      await f.prepare();const manifest=JSON.parse(await readFile(join(f.root,'rollback/manifest.json')));
      const metadata=async url=>{if(!url.includes('/jobs?'))return f.metadata(url);const jobs=f.jobs();if(change==='producer')jobs.jobs[0].status='in_progress';if(change==='attempt')jobs.jobs[0].run_attempt=2;return jobs;};
      const runner=async(binary,args,options)=>{
        if(change==='settings'&&args[0]==='scripts/worker-release-identity.mjs')throw Error('synthetic setting drift');
        if(binary==='az'){assert.deepEqual(args.slice(0,3),['storage','blob','list']);assert.ok(args.includes('login'));return {stdout:JSON.stringify(change==='added'?[...manifest,{...manifest[0],name:'unbacked.js'}]:manifest)};}
        return f.runner(binary,args,options);
      };
      if(change==='missing')await rm(join(f.root,'.publication/rollback-compatibility.json'));
      if(change==='bytes')f.blobs.get('assets/app.js').bytes=Buffer.from('changed');if(change==='etag')f.blobs.get('assets/app.js').etag='"drift"';
      if(change==='mode'){const releasePath=join(f.root,'jarvis-release.json'),release=JSON.parse(await readFile(releasePath));release.preserveDriveCatalog=false;await writeFile(releasePath,JSON.stringify(release));}
      const operation=rollbackPairCommand('authorize-change',{...f.opts,metadata,runner});
      if(change==='none')assert.equal((await operation).providerChangesAuthorized,true);else await assert.rejects(operation);
      assert.equal(f.writes.length,0,change);
    }finally{await f.cleanup();}
  }
});
test('schema extraction fails closed on dynamic, destructive, unresolved or unexpected SQL contracts',async()=>{
  const f=await commandFixture();try{
    assert.equal((await schemaAt(join(f.root,'.jarvis-source'),f.sourceSHA)).length,1);
    for(const code of ["db.exec('DROP TABLE synthetic_pending');","db.exec(`CREATE TABLE IF NOT EXISTS ${name}(id TEXT)`);","const sql='CREATE TABLE IF NOT EXISTS missing(id TEXT)'; db.exec(sql);","db.exec('CREATE TABLE new_table(id TEXT)');"]){
      const runner=async(binary,args)=>({stdout:args.includes('ls-tree')?'backend/worker.js\n':code});await assert.rejects(schemaAt('synthetic',f.sourceSHA,{runner}));
    }
  }finally{await f.cleanup();}
});
