import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {artifactIdentity,fileManifest} from '../scripts/qualified-artifact.mjs';
import {verifyBackupFiles} from '../scripts/backup-jarvis-storage.mjs';
import {publicationCommand,checkedActionApproval,checkedRollbackPair} from '../scripts/publish-jarvis-versioned.mjs';
import {sha256,mimeFor,POINTER,ROOT} from '../scripts/static-publication.mjs';

const policy="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'";
const html=name=>Buffer.from('<!doctype html><head><meta http-equiv="Content-Security-Policy" content="'+policy+'"><script src="/assets/app.js"></script></head><body>'+name+'</body>');
const recipes=['static-publication.mjs','static-release-loader.js','azure-static-store.mjs','publish-jarvis-versioned.mjs','release-recovery-plan.mjs'];
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const commit=root=>{git(root,'init');git(root,'add','.');git(root,'-c','user.name=Recovery fixture','-c','user.email=fixture@example.test','commit','-m','synthetic fixture');return git(root,'rev-parse','HEAD');};
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'versioned-command-')),source=join(root,'.jarvis-source');
  await mkdir(source);await writeFile(join(source,'package-lock.json'),'{}');const sourceSHA=commit(source);
  await mkdir(join(root,'scripts'));for(const name of recipes)await copyFile(new URL('../scripts/'+name,import.meta.url),join(root,'scripts',name));
  await writeFile(join(root,'scripts/build-jarvis.mjs'),'// synthetic qualified build recipe');
  await writeFile(join(root,'package-lock.json'),'{}');await writeFile(join(root,'jarvis-release.json'),JSON.stringify({repository:'braydenparker999/jarvis',commit:sourceSHA,storageOrigin:'https://missionarytube.z13.web.core.windows.net',apiOrigin:'https://jarvis-hub-api.braydenparker999.workers.dev'}));
  await writeFile(join(root,'.gitignore'),'.jarvis-source/\ndist/\nrollback/\n.publication/\n*artifact.json\nworker-identity-current.json\n');const orchestration=commit(root);
  const env={GITHUB_REPOSITORY:'braydenparker000/Missionarytube-',GITHUB_REF:'refs/heads/main',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',STORAGE_ACCOUNT:'missionarytube',CLOUDFLARE_API_TOKEN:'SYNTHETIC_SECRET',CLOUDFLARE_ACCOUNT_ID:'SYNTHETIC_ACCOUNT'};
  const old=new Map([['index.html',html('old')],['assets/app.js',Buffer.from('window.old=true;')]]);
  const next=new Map([['index.html',html('candidate')],['assets/app.js',Buffer.from('window.candidate=true;')]]);
  for(const [kind,files] of [['dist',next],['rollback/files',old]])for(const [path,bytes] of files){const dest=join(root,kind,path);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,bytes);}
  const identity=await artifactIdentity({root,env}),files=await fileManifest(join(root,'dist')),base={identity,files};
  await writeFile(join(root,'qualified-artifact.json'),JSON.stringify(base));await writeFile(join(root,'configured-artifact.json'),JSON.stringify({identity:{...identity,baseManifestDigest:sha256(base)},files}));
  await writeFile(join(root,'worker-identity-current.json'),JSON.stringify({candidate:{source:sourceSHA,orchestration},live:{version:'12345678-1234-1234-1234-123456789abc',settingsDigest:'a'.repeat(64)}}));
  const manifest=[...old].map(([name,bytes])=>({name,properties:{contentLength:bytes.length,etag:'"old-'+name+'"',contentSettings:{contentType:mimeFor(name),contentMd5:createHash('md5').update(bytes).digest('base64')}}}));
  await writeFile(join(root,'rollback/manifest.json'),JSON.stringify(manifest));await writeFile(join(root,'rollback/verified-backup.json'),JSON.stringify({schema:1,account:'missionarytube',container:'$web',files:await verifyBackupFiles(manifest,join(root,'rollback/files'))}));
  const blobs=new Map([...old].map(([name,bytes])=>[name,{bytes,contentType:mimeFor(name),etag:'"old-'+name+'"'}])),writes=[],calls=[];let serial=0;
  const store={get:async key=>blobs.get(key),route:async key=>blobs.get(key+'index.html'),put:async(key,bytes,contentType,condition)=>{
    if(condition.ifNoneMatch==='*'&&blobs.has(key)||condition.ifMatch&&condition.ifMatch!==blobs.get(key)?.etag)throw Error('provider precondition');
    blobs.set(key,{bytes,contentType,etag:'"write-'+(++serial)+'"'});writes.push(key);
  }};
  const runner=async(binary,args,options)=>{calls.push({binary,args,env:options.env});return {stdout:'fixture pass'};};
  return {root,env,store,writes,calls,runner,blobs,cleanup:()=>rm(root,{recursive:true,force:true})};
}
test('production command fixture seals original proof, stages, bootstraps, promotes and verifies without mutable asset writes',async()=>{
  const f=await fixture();try{
    const opts={root:f.root,env:f.env,store:f.store,runner:f.runner};
    const prepared=await publicationCommand('prepare',opts);assert.equal(prepared.initial,true);assert.equal(f.writes.length,0);
    await publicationCommand('stage',opts);assert.ok(f.writes.every(path=>path.startsWith(ROOT)));assert.equal(f.blobs.get(POINTER),undefined);
    await publicationCommand('bootstrap',opts);assert.equal(JSON.parse(f.blobs.get(POINTER).bytes).releaseId,prepared.previousReleaseId);
    await publicationCommand('promote',opts);const verified=await publicationCommand('verify',opts);assert.equal(verified.releaseId,prepared.releaseId);assert.match(verified.publicationDigest,/^[a-f0-9]{64}$/);
    assert.ok(!f.writes.includes('assets/app.js'));assert.ok(f.calls.some(call=>call.args.includes('scripts/worker-release-identity.mjs')));
    const state=JSON.parse(await readFile(join(f.root,'.publication/state.json')));assert.equal(state.phase,'verified');assert.ok(!JSON.stringify(state).includes('SYNTHETIC_SECRET'));
  }finally{await f.cleanup();}
});
test('a later release reconstructs the selected previous publication from a full backup and changes only its pointer',async()=>{
  const f=await fixture();try{
    const opts={root:f.root,env:f.env,store:f.store,runner:f.runner};
    for(const command of ['prepare','stage','bootstrap','promote','verify'])await publicationCommand(command,opts);
    const first=JSON.parse(f.blobs.get(POINTER).bytes).releaseId;
    await rm(join(f.root,'rollback/files'),{recursive:true});
    const manifest=[];
    for(const [name,item] of f.blobs){
      const path=join(f.root,'rollback/files',name);await mkdir(dirname(path),{recursive:true});await writeFile(path,item.bytes);
      manifest.push({name,properties:{contentLength:item.bytes.length,etag:item.etag,contentSettings:{contentType:item.contentType,contentMd5:createHash('md5').update(item.bytes).digest('base64')}}});
    }
    await writeFile(join(f.root,'rollback/manifest.json'),JSON.stringify(manifest));
    await writeFile(join(f.root,'rollback/verified-backup.json'),JSON.stringify({schema:1,account:'missionarytube',container:'$web',files:await verifyBackupFiles(manifest,join(f.root,'rollback/files'))}));
    opts.env={...f.env,GITHUB_RUN_ID:'124'};
    const identity=await artifactIdentity({root:f.root,env:opts.env}),files=await fileManifest(join(f.root,'dist')),base={identity,files};
    await writeFile(join(f.root,'qualified-artifact.json'),JSON.stringify(base));
    await writeFile(join(f.root,'configured-artifact.json'),JSON.stringify({identity:{...identity,baseManifestDigest:sha256(base)},files}));
    const next=await publicationCommand('prepare',opts);assert.equal(next.initial,false);assert.equal(next.previousReleaseId,first);
    await publicationCommand('stage',opts);const before=f.writes.length;await publicationCommand('bootstrap',opts);assert.equal(f.writes.length,before);
    await publicationCommand('promote',opts);assert.deepEqual(f.writes.slice(before),[POINTER]);
    await publicationCommand('verify',opts);assert.notEqual(next.releaseId,first);
  }finally{await f.cleanup();}
});
test('unknown branch/run or mutated artifact, recipe, previous plan or complete backup refuses any release write',async()=>{
  for(const kind of ['branch','run','artifact','recipe','previous','backup']){
    const f=await fixture();try{
      const opts={root:f.root,env:f.env,store:f.store,runner:f.runner};await publicationCommand('prepare',opts);
      if(kind==='branch')opts.env={...f.env,GITHUB_REF:'refs/heads/unapproved'};
      if(kind==='run')opts.env={...f.env,GITHUB_RUN_ID:'999'};
      if(kind==='artifact')await writeFile(join(f.root,'dist/assets/app.js'),'changed');
      if(kind==='recipe')await writeFile(join(f.root,'scripts/static-release-loader.js'),'changed');
      if(kind==='previous'){
        const file=join(f.root,'.publication/previous/canonical/index.html'),bytes=Buffer.from('changed previous document'),planPath=join(f.root,'.publication/previous/plan.json');
        await writeFile(file,bytes);const plan=JSON.parse(await readFile(planPath));
        Object.assign(plan.canonical.find(item=>item.path==='index.html'),{bytes:bytes.length,sha256:sha256(bytes)});
        await writeFile(planPath,JSON.stringify(plan));
      }
      if(kind==='backup')await writeFile(join(f.root,'rollback/files/assets/app.js'),'changed');
      await assert.rejects(publicationCommand('stage',opts));assert.equal(f.writes.length,0);
    }finally{await f.cleanup();}
  }
});
test('manual resume requires exact action approval and isolates fresh readiness from provider credentials',async()=>{
  const f=await fixture();try{
    const opts={root:f.root,env:f.env,store:f.store,runner:f.runner};await publicationCommand('prepare',opts);
    const context=JSON.parse(await readFile(join(f.root,'.publication/context.json'))),candidate={plan:JSON.parse(await readFile(join(f.root,'.publication/candidate/plan.json')))},previous={plan:JSON.parse(await readFile(join(f.root,'.publication/previous/plan.json')))},expected=JSON.parse(await readFile(join(f.root,'.publication/expected-pointer.json')));
    const approval={schema:1,action:'resume',account:'missionarytube',container:'$web',releaseId:context.releaseId,previousReleaseId:context.previousReleaseId,artifactDigest:context.artifactDigest,backupDigest:context.backupDigest,backendIdentityDigest:context.backendIdentityDigest,expectedPointer:expected};
    for(const change of [{action:'rollback'},{account:'other'},{releaseId:'b'.repeat(64)},{artifactDigest:'b'.repeat(64)}])assert.throws(()=>checkedActionApproval({...approval,...change},{action:'resume',context,candidate,previous,expected}));
    await assert.rejects(publicationCommand('resume',opts),/approval/);assert.equal(f.writes.length,0);
    await publicationCommand('resume',{...opts,approval});
    const lane=f.calls.find(call=>call.args.some(arg=>arg.endsWith('/scripts/verify-podcasts.mjs')));assert.ok(lane);
    assert.equal(lane.env.CLOUDFLARE_API_TOKEN,undefined);assert.equal(lane.env.CLOUDFLARE_ACCOUNT_ID,undefined);assert.ok(lane.env.HOME.startsWith(join(f.root,'.publication/readiness-')));
  }finally{await f.cleanup();}
});
test('a rollback needs an exact successful immutable pair stamp, not a file asserting compatibility',()=>{
  const previous={plan:{releaseId:'a'.repeat(64)}},context={backendIdentityDigest:'b'.repeat(64),orchestration:'c'.repeat(40)},pair={schema:1,previousReleaseId:previous.plan.releaseId,backendIdentityDigest:context.backendIdentityDigest,schemaBackwardCompatible:true,pendingWorkCompatible:true,exactPairQualified:true};
  const recipe=[{path:'.github/workflows/deploy-azure-storage.yml',sha:'d'.repeat(40)}],tree={truncated:false,tree:recipe.map(entry=>({...entry,type:'blob'}))};
  const proof={pair,pairDigest:sha256(pair),recipe,orchestration:context.orchestration,runId:'123',attempt:'1'},repo={full_name:'braydenparker000/Missionarytube-'};
  const run={id:123,run_attempt:1,repository:repo,head_repository:repo,head_sha:proof.orchestration,status:'completed',conclusion:'success',event:'push',head_branch:'main',path:'.github/workflows/deploy-azure-storage.yml'};
  const jobs={total_count:1,jobs:[{run_id:123,run_attempt:1,head_sha:proof.orchestration,status:'completed',conclusion:'success',steps:[{name:'verified-recovery-pair-'+proof.pairDigest,status:'completed',conclusion:'success'}]}]};
  const opts={previous,context,run,jobs,tree,recipe};checkedRollbackPair(proof,opts);
  for(const change of [{conclusion:'failure'},{head_sha:'d'.repeat(40)},{run_attempt:2},{head_repository:{...repo,fork:true}},{event:'pull_request'}])assert.throws(()=>checkedRollbackPair(proof,{...opts,run:{...run,...change}}));
  assert.throws(()=>checkedRollbackPair(pair,opts));
  assert.throws(()=>checkedRollbackPair({...proof,pair:{...pair,pendingWorkCompatible:false}},opts));
  assert.throws(()=>checkedRollbackPair(proof,{...opts,jobs:{...jobs,total_count:2}}));
  assert.throws(()=>checkedRollbackPair(proof,{...opts,jobs:{total_count:1,jobs:[{...jobs.jobs[0],steps:[]}]}}));
  assert.throws(()=>checkedRollbackPair(proof,{...opts,tree:{...tree,truncated:true}}));
  assert.throws(()=>checkedRollbackPair(proof,{...opts,tree:{...tree,tree:[{...tree.tree[0],sha:'f'.repeat(40)}]}}));
});
