import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {publicationCommand,preservedPublication,checkedActionApproval,checkedRollbackPair} from '../scripts/publish-jarvis-versioned.mjs';
import {rollbackPairContracts} from '../scripts/rollback-pair-contracts.mjs';
import {sha256,mimeFor,POINTER,ROOT} from '../scripts/static-publication.mjs';
import {commandFixture} from './fixtures/release-recovery/command-fixture.mjs';

test('full production commands seal, stage, bootstrap, promote and verify without shared asset overwrites',async()=>{
  const f=await commandFixture();try{
    const prepared=await f.prepare();assert.equal(prepared.initial,true);assert.equal(f.writes.length,0);
    await publicationCommand('stage',f.opts);assert.ok(f.writes.every(path=>path.startsWith(ROOT)));assert.equal(f.blobs.get(POINTER),undefined);
    await publicationCommand('bootstrap',f.opts);assert.equal(JSON.parse(f.blobs.get(POINTER).bytes).releaseId,prepared.previousReleaseId);
    await publicationCommand('promote',f.opts);const verified=await publicationCommand('verify',f.opts);assert.equal(verified.releaseId,prepared.releaseId);
    assert.match(verified.publicationDigest,/^[a-f0-9]{64}$/);assert.ok(!f.writes.includes('assets/app.js'));
    const state=JSON.parse(await readFile(join(f.root,'.publication/state.json')));assert.equal(state.phase,'verified');assert.ok(!JSON.stringify(state).includes('SYNTHETIC_SECRET'));
  }finally{await f.cleanup();}
});
test('a later release reconstructs its exact previous publication from complete backup and changes only the pointer',async()=>{
  const f=await commandFixture();try{
    await f.prepare();for(const command of ['stage','bootstrap','promote','verify'])await publicationCommand(command,f.opts);
    const first=JSON.parse(f.blobs.get(POINTER).bytes).releaseId;await f.backup();f.opts.env={...f.env,GITHUB_RUN_ID:'124'};await f.seal();
    const next=await publicationCommand('prepare',f.opts);assert.equal(next.initial,false);assert.equal(next.previousReleaseId,first);
    const proof=await f.pair(),metadata=async url=>{
      if(url.includes('/git/trees/'))return f.tree;
      if(url.includes('/jobs?')){const jobs=f.jobs();for(const job of jobs.jobs)job.run_id=124;return jobs;}
      return {...f.run(),id:124};
    };
    assert.equal(proof.runId,'124');const opts={...f.opts,metadata};
    await publicationCommand('stage',opts);const start=f.writes.length;await publicationCommand('bootstrap',opts);assert.equal(f.writes.length,start);
    await publicationCommand('promote',opts);assert.deepEqual(f.writes.slice(start),[POINTER]);await publicationCommand('verify',opts);
  }finally{await f.cleanup();}
});
test('branch, run, artifact, committed recipe, transitive helper, previous plan and backup drift refuse release writes',async()=>{
  for(const kind of ['branch','run','artifact','recipe','worker_verifier','readiness','helper','previous','backup']){
    const f=await commandFixture();try{
      await f.prepare();const opts={...f.opts};
      if(kind==='branch')opts.env={...f.env,GITHUB_REF:'refs/heads/unapproved'};
      if(kind==='run')opts.env={...f.env,GITHUB_RUN_ID:'999'};
      if(kind==='artifact')await writeFile(join(f.root,'dist/assets/app.js'),'changed');
      if(kind==='recipe')await writeFile(join(f.root,'scripts/static-release-loader.js'),'changed');
      if(kind==='worker_verifier')await writeFile(join(f.root,'scripts/worker-release-identity.mjs'),'changed');
      if(kind==='readiness')await writeFile(join(f.root,'scripts/check-jarvis-api.mjs'),'changed');
      if(kind==='helper')await writeFile(join(f.root,'.jarvis-source/tests/helpers/indirect.js'),'changed');
      if(kind==='previous'){
        const file=join(f.root,'.publication/previous/canonical/index.html'),bytes=Buffer.from('changed previous document'),planPath=join(f.root,'.publication/previous/plan.json');
        await writeFile(file,bytes);const plan=JSON.parse(await readFile(planPath));Object.assign(plan.canonical.find(item=>item.path==='index.html'),{bytes:bytes.length,sha256:sha256(bytes)});await writeFile(planPath,JSON.stringify(plan));
      }
      if(kind==='backup')await writeFile(join(f.root,'rollback/files/assets/app.js'),'changed');
      await assert.rejects(publicationCommand('stage',opts));assert.equal(f.writes.length,0,kind);
    }finally{await f.cleanup();}
  }
});
test('missing, stale or unexecuted pair proof stops every forward provider-write command',async()=>{
  for(const command of ['stage','bootstrap','promote'])for(const change of ['missing','schema','pending','producer','stamp','activation']){
    const f=await commandFixture();try{
      await f.prepare();const proofPath=join(f.root,'.publication/rollback-compatibility.json');
      if(change==='missing')await rm(proofPath);
      if(['schema','pending'].includes(change)){
        const proof=JSON.parse(await readFile(proofPath));proof.record.bindings[change==='schema'?'schemaInputsDigest':'pendingRuntimeDigest']='f'.repeat(64);proof.pairDigest=sha256(proof.record);await writeFile(proofPath,JSON.stringify(proof));
      }
      const metadata=async url=>{if(!url.includes('/jobs?'))return f.metadata(url);const jobs=f.jobs();
        if(change==='producer')jobs.jobs[0].conclusion='failure';if(change==='stamp')jobs.jobs[0].steps[1].name='verified-recovery-pair-'+ 'f'.repeat(64);
        if(change==='activation')jobs.jobs[1].steps[1].name='verified-release-backend-'+ 'f'.repeat(64);return jobs;};
      await assert.rejects(publicationCommand(command,{...f.opts,metadata}));assert.equal(f.writes.length,0,command+' '+change);
    }finally{await f.cleanup();}
  }
});
test('manual resume requires exact approval and isolates fresh readiness from all provider credentials',async()=>{
  const f=await commandFixture();try{
    await f.prepare();f.finish('cancelled');const approval=await f.approve('resume'),inputs=await preservedPublication(f.opts),expected=approval.expectedPointer;
    for(const change of [{action:'rollback'},{account:'other'},{releaseId:'b'.repeat(64)},{artifactDigest:'b'.repeat(64)}])assert.throws(()=>checkedActionApproval({...approval,...change},{action:'resume',...inputs,expected}));
    await assert.rejects(publicationCommand('resume',f.opts),/approval/);assert.equal(f.writes.length,0);
    await publicationCommand('resume',{...f.opts,env:{...f.env,GITHUB_RUN_ID:'999'},approval});
    const lane=f.calls.find(call=>call.args.some(arg=>arg.endsWith('/scripts/verify-podcasts.mjs')));assert.ok(lane);
    assert.equal(lane.env.CLOUDFLARE_API_TOKEN,undefined);assert.equal(lane.env.CLOUDFLARE_ACCOUNT_ID,undefined);assert.ok(lane.env.HOME.startsWith(join(f.root,'.publication/readiness-')));
  }finally{await f.cleanup();}
});
test('full approved rollback and previous-target verification survive a failed or cancelled later deployment',async()=>{
  for(const conclusion of ['failure','cancelled'])for(const lostResponse of [false,true]){
    const f=await commandFixture();try{
      const prepared=await f.prepare();for(const command of ['stage','bootstrap','promote'])await publicationCommand(command,f.opts);
      f.finish(conclusion);await publicationCommand('inspect',f.opts);const approval=await f.approve('rollback'),opts={...f.opts,env:{...f.env,GITHUB_RUN_ID:'999'},approval};
      const start=f.writes.length;if(lostResponse){f.interrupt(start,true);await assert.rejects(publicationCommand('rollback',opts),/after provider commit/);f.interrupt(Infinity);}
      const selected=await publicationCommand('rollback',opts);assert.equal(selected.releaseId,prepared.previousReleaseId);assert.equal(selected.reconciled,lostResponse);
      assert.deepEqual(f.writes.slice(start),[POINTER]);
      const verified=await publicationCommand('verify',{...f.opts,verifyTarget:'previous'});assert.equal(verified.releaseId,prepared.previousReleaseId);
      assert.equal((await publicationCommand('verify',f.opts)).releaseId,prepared.previousReleaseId);
      const state=JSON.parse(await readFile(join(f.root,'.publication/state.json')));assert.equal(state.phase,'verified');assert.equal(state.releaseId,prepared.previousReleaseId);
      await assert.rejects(publicationCommand('verify',{...f.opts,verifyTarget:'candidate'}),/verification target/);
    }finally{await f.cleanup();}
  }
});
test('foreign, malformed, wrong-MIME and later pointers cannot be inspected or approved over with an old checkpoint',async()=>{
  for(const kind of ['foreign','malformed','mime','later']){
    const f=await commandFixture();try{
      await f.prepare();for(const command of ['stage','bootstrap','promote'])await publicationCommand(command,f.opts);f.finish('failure');
      await publicationCommand('inspect',f.opts);const approval=await f.approve('rollback'),start=f.writes.length;
      const item=f.blobs.get(POINTER);if(kind==='mime')item.contentType='text/plain';else item.bytes=Buffer.from(kind==='malformed'?'{':JSON.stringify({schema:1,releaseId:'f'.repeat(64),prefix:'/_jarvis/releases/'+ 'f'.repeat(64)+'/'}));
      item.etag='"later-release"';await assert.rejects(publicationCommand('inspect',f.opts),/malformed, foreign or a later/);
      await assert.rejects(publicationCommand('rollback',{...f.opts,approval}),/malformed, foreign or a later/);assert.equal(f.writes.length,start);
      await assert.rejects(publicationCommand('stage',f.opts),/malformed, foreign or a later/);assert.equal(f.writes.length,start);
    }finally{await f.cleanup();}
  }
});
test('bootstrap never adopts a pointer changed during installation or after final verification',async()=>{
  for(const late of [false,true]){
    const f=await commandFixture();try{
      await f.prepare();await publicationCommand('stage',f.opts);const originalGet=f.store.get,originalPut=f.store.put;let pointerReads=0;
      const foreign=()=>f.blobs.set(POINTER,{bytes:Buffer.from('{"foreign":true}\n'),contentType:mimeFor(POINTER),etag:'"foreign"'});
      if(late)f.store.get=async key=>{if(key===POINTER&&++pointerReads===4)foreign();return originalGet(key);};
      else f.store.put=async(...args)=>{await originalPut(...args);if(args[0]==='index.html')foreign();};
      await assert.rejects(publicationCommand('bootstrap',f.opts),/pointer|foreign/i);
      const expected=JSON.parse(await readFile(join(f.root,'.publication/expected-pointer.json')));assert.equal(expected.etag,null);
      const start=f.writes.length;await assert.rejects(publicationCommand('promote',f.opts));assert.equal(f.writes.length,start);
    }finally{await f.cleanup();}
  }
});
test('hosted proof requires ordered successful independent producer and activation stamps at the original head',async()=>{
  const f=await commandFixture();try{
    await f.prepare();f.finish('failure');const inputs=await preservedPublication(f.opts),contracts=await rollbackPairContracts({...inputs,root:f.root}),proof=await f.pair();
    const opts={...inputs,contracts,currentBackend:f.currentBackend,run:f.run(),jobs:f.jobs(),tree:f.tree,recipe:f.backend.candidate.recipe};
    assert.equal(checkedRollbackPair(proof,opts),true);
    for(const change of [{head_sha:'d'.repeat(40)},{run_attempt:2},{head_repository:{full_name:f.env.GITHUB_REPOSITORY,fork:true}},{event:'pull_request'},{status:'in_progress',conclusion:null}])assert.throws(()=>checkedRollbackPair(proof,{...opts,run:{...opts.run,...change}}));
    assert.throws(()=>checkedRollbackPair({...proof,record:{...proof.record,evidence:{schemaBackwardCompatible:true,pendingWorkCompatible:true}}},opts));
    for(const field of ['schemaInputsDigest','pendingRuntimeDigest','runtimeRecipeDigest','artifactDigest','backupDigest','backendDigest']){
      const changed=structuredClone(proof);changed.record.bindings[field]='f'.repeat(64);changed.pairDigest=sha256(changed.record);assert.throws(()=>checkedRollbackPair(changed,opts),field);
    }
    for(const mutate of [jobs=>jobs.total_count++,jobs=>jobs.jobs[0].steps.reverse().forEach((step,index)=>step.number=index+1),jobs=>jobs.jobs[0].steps[0].conclusion='failure',jobs=>jobs.jobs[1].steps.pop()]){
      const jobs=f.jobs();mutate(jobs);assert.throws(()=>checkedRollbackPair(proof,{...opts,jobs}));
    }
    assert.throws(()=>checkedRollbackPair(proof,{...opts,currentBackend:{...f.currentBackend,live:{...f.currentBackend.live,settingsDigest:'f'.repeat(64)}}}));
    assert.throws(()=>checkedRollbackPair(proof,{...opts,tree:{...f.tree,truncated:true}}));
  }finally{await f.cleanup();}
});
