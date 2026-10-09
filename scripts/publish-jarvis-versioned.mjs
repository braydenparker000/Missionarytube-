import {readFile,writeFile,mkdir,rename,mkdtemp,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isDeepStrictEqual} from 'node:util';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {artifactIdentity,checkedManifest,checkedConfigurationDelta,fileManifest} from './qualified-artifact.mjs';
import {verifyBackupFiles} from './backup-jarvis-storage.mjs';
import {azureStaticStore} from './azure-static-store.mjs';
import {buildPublication,readTree,inventory,sha256,savePublication,loadPublication,stageRelease,installLoaders,switchPointer,verifyRelease,compatibleLoaders,recognizedPointer,POINTER,ROOT,RELEASE_MANIFEST,mimeFor} from './static-publication.mjs';
import {boundedEvidence} from './release-recovery-plan.mjs';
import {prewriteLanes} from './overlap-jarvis-prewrite.mjs';
import {checkedPairRecord,PAIR_STAMP} from './rollback-pair-proof.mjs';
import {rollbackPairContracts} from './rollback-pair-contracts.mjs';
const execute=promisify(execFile),DIRECTORY='.publication';
const readJSON=async path=>JSON.parse(await readFile(path,'utf8'));
const saveJSON=async(path,value)=>{await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path+'.tmp',JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(path+'.tmp',path);};
export const PUBLICATION_RECIPE_FILES=Object.freeze(['.github/workflows/deploy-azure-storage.yml','.github/workflows/qualify-jarvis.yml',
  'scripts/build-jarvis.mjs','scripts/r2-player-config.mjs','scripts/plan-jarvis-qualification.mjs','scripts/install-jarvis-browser.mjs',
  'scripts/worker-release-identity.mjs','scripts/prepare-music-worker.mjs','scripts/prepare-worker-tools.mjs','scripts/check-music-worker-bindings.mjs',
  'scripts/check-jarvis-api.mjs','scripts/qualified-artifact.mjs','scripts/backup-jarvis-storage.mjs','scripts/overlap-jarvis-prewrite.mjs',
  'scripts/static-publication.mjs','scripts/static-release-loader.js','scripts/azure-static-store.mjs','scripts/publish-jarvis-versioned.mjs',
  'scripts/release-recovery-plan.mjs','scripts/rollback-pair-proof.mjs','scripts/rollback-pair-contracts.mjs','scripts/qualify-jarvis-rollback-pair.mjs',
  'scripts/rollback-pair-runtime.mjs','tests/fixtures/release-recovery/schema-recovery.py']);
export async function publicationRecipe(root){return sha256(await Promise.all(PUBLICATION_RECIPE_FILES.map(async path=>{
  const bytes=await readFile(join(root,path)),committed=(await execute('git',['-C',root,'show','HEAD:'+path],{encoding:'buffer',maxBuffer:1024*1024})).stdout;
  if(!Buffer.isBuffer(committed)||sha256(bytes)!==sha256(committed))throw Error('Publication recipe differs from immutable orchestration HEAD');
  return {path,digest:sha256(bytes)};
})));}
async function sealedCandidate(root,env){
  const configured=await readJSON(join(root,'configured-artifact.json')),base=await readJSON(join(root,'qualified-artifact.json'));
  const identity=await artifactIdentity({root,env}),files=await fileManifest(join(root,'dist'));
  checkedConfigurationDelta(base.files,files);
  checkedManifest(configured,{...identity,baseManifestDigest:sha256(base)},files);
  if(JSON.stringify(identity)!==JSON.stringify(base.identity))throw Error('Exact qualified base identity changed');
  const backend=await readJSON(join(root,'worker-identity-planned.json'));
  if(backend.candidate.source!==identity.source||backend.candidate.orchestration!==identity.orchestration)throw Error('Backend checkpoint differs from exact frontend identity');
  return buildPublication(await readTree(join(root,'dist')),{proof:{kind:'same-run-configured-artifact',identity,artifactDigest:sha256(configured),backendIdentityDigest:sha256(backend)},recipe:await publicationRecipe(root),loader:await readFile(join(root,'scripts/static-release-loader.js'))});
}
export async function preparePublication({root=process.cwd(),env=process.env}={}){
  const candidate=await sealedCandidate(root,env),manifest=await readJSON(join(root,'rollback/manifest.json'));
  const verified=await verifyBackupFiles(manifest,join(root,'rollback/files')),saved=await readJSON(join(root,'rollback/verified-backup.json'));
  if(saved.account!=='missionarytube'||saved.container!=='$web'||JSON.stringify(saved.files)!==JSON.stringify(verified))throw Error('Verified complete static backup changed');
  const backup=await readTree(join(root,'rollback/files')),pointerBytes=backup.get(POINTER);let previous;
  if(pointerBytes){
    const pointer=JSON.parse(pointerBytes),plan=JSON.parse(backup.get(ROOT+pointer.releaseId+'/'+RELEASE_MANIFEST)||'null');
    if(!plan||JSON.stringify(pointer)!==JSON.stringify(plan.pointer))throw Error('Previous release manifest unavailable');
    const payload=new Map(plan.files.map(file=>[file.path,backup.get(ROOT+plan.releaseId+'/'+file.path)])),canonical=new Map(plan.canonical.map(file=>[file.path,backup.get(file.path)]));
    if([...payload.values(),...canonical.values()].some(bytes=>!Buffer.isBuffer(bytes)))throw Error('Previous release backup incomplete');
    previous={plan,payload,canonical};
    await savePublication(previous,join(root,DIRECTORY,'previous'));previous=await loadPublication(join(root,DIRECTORY,'previous'));
  }else{
    // Freeze the complete existing static site, including unreferenced assets.
    // Media/unbounded payloads or policy/route changes stop for migration review.
    previous=buildPublication(backup,{proof:{kind:'verified-static-backup',backupDigest:sha256(saved)},recipe:candidate.plan.recipe,loader:await readFile(join(root,'scripts/static-release-loader.js'))});
    previous.original=backup;
  }
  compatibleLoaders(previous,candidate);
  await savePublication(previous,join(root,DIRECTORY,'previous'));await savePublication(candidate,join(root,DIRECTORY,'candidate'));
  const pointerItem=manifest.find(item=>item.name===POINTER);
  await saveJSON(join(root,DIRECTORY,'expected-pointer.json'),{etag:pointerItem?.properties.etag??null,sha256:pointerBytes?sha256(pointerBytes):null});
  await saveJSON(join(root,DIRECTORY,'context.json'),{schema:1,initial:!pointerBytes,orchestration:candidate.plan.proof.identity.orchestration,backupDigest:sha256(saved),artifactDigest:candidate.plan.proof.artifactDigest,backendIdentityDigest:candidate.plan.proof.backendIdentityDigest,releaseId:candidate.plan.releaseId,previousReleaseId:previous.plan.releaseId});
  await saveJSON(join(root,DIRECTORY,'state.json'),boundedEvidence({phase:'prepared',releaseId:candidate.plan.releaseId,artifactDigest:candidate.plan.proof.artifactDigest,backupDigest:sha256(saved),checks:[{name:'artifact',status:'pass'},{name:'static_backup',status:'pass'},{name:'database_recovery',status:'unknown'}]}));
  return {phase:'prepared',releaseId:candidate.plan.releaseId,previousReleaseId:previous.plan.releaseId,initial:!pointerBytes};
}
export function checkedActionApproval(approval,{action,context,candidate,previous,expected}){
  const required={schema:1,action,account:'missionarytube',container:'$web',releaseId:candidate.plan.releaseId,previousReleaseId:previous.plan.releaseId,
    artifactDigest:context.artifactDigest,backupDigest:context.backupDigest,backendIdentityDigest:context.backendIdentityDigest,expectedPointer:expected};
  if(!isDeepStrictEqual(approval,required))throw Error('Exact per-action recovery approval required');
  return true;
}
export function checkedRollbackPair(proof,{candidate,previous,context,backend,contracts,currentBackend,run,jobs,tree,recipe,promotion=false,prewrite=false}){
  checkedPairRecord(proof,{candidate,previous,context,backend,contracts});
  const digest=proof.pairDigest,repo='braydenparker000/Missionarytube-';
  if(!/^[a-f0-9]{40}$/.test(proof.orchestration||'')||proof.orchestration!==context.orchestration||
    !/^[1-9][0-9]{0,14}$/.test(proof.runId||'')||!/^[1-9][0-9]{0,5}$/.test(proof.attempt||'')||
    proof.runId!==candidate.plan.proof.identity.runId||proof.attempt!==candidate.plan.proof.identity.attempt)throw Error('Exact rollback pair proof required');
  if(!Array.isArray(recipe)||!recipe.length||!isDeepStrictEqual(proof.recipe,recipe)||tree?.truncated!==false||!Array.isArray(tree.tree))throw Error('Immutable rollback qualification recipe required');
  for(const entry of recipe){const files=tree.tree.filter(f=>f.path===entry.path&&f.type==='blob');if(files.length!==1||files[0].sha!==entry.sha)throw Error('Rollback qualification recipe changed');}
  if(!run||run.repository?.full_name!==repo||run.head_repository?.full_name!==repo||run.head_repository?.fork===true||run.head_sha!==proof.orchestration||
    String(run.id)!==proof.runId||String(run.run_attempt)!==proof.attempt||
    !(run.status==='completed'&&['success','failure','cancelled'].includes(run.conclusion)||promotion&&run.status==='in_progress'&&run.conclusion===null)||
    !['push','workflow_dispatch'].includes(run.event)||run.head_branch!=='main'||run.path!=='.github/workflows/deploy-azure-storage.yml')throw Error('Successful immutable rollback qualification required');
  if(!jobs||!Array.isArray(jobs.jobs)||jobs.total_count!==jobs.jobs.length||jobs.jobs.length>100)throw Error('Complete rollback qualification jobs required');
  const producers=jobs.jobs.filter(job=>job.name==='rollback-pair'&&job.status==='completed'&&job.conclusion==='success'&&job.run_id===run.id&&job.run_attempt===run.run_attempt&&job.head_sha===proof.orchestration);
  if(producers.length!==1)throw Error('Independently completed exact rollback-pair producer required');
  const steps=producers[0].steps||[],qualification=steps.filter(step=>step.name==='Qualify the exact previous frontend and candidate backend pair'&&step.status==='completed'&&step.conclusion==='success'),
    stamps=steps.filter(step=>step.name===PAIR_STAMP+digest&&step.status==='completed'&&step.conclusion==='success'),
    archives=steps.filter(step=>step.name==='Preserve the exact qualified rollback pair'&&step.status==='completed'&&step.conclusion==='success');
  if(qualification.length!==1||stamps.length!==1||archives.length!==1||!(qualification[0].number<stamps[0].number&&stamps[0].number<archives[0].number))throw Error('Digest-bound executed and archived rollback qualification required');
  if(!prewrite){
    if(!currentBackend||!isDeepStrictEqual(currentBackend.candidate,backend.candidate)||currentBackend.live?.settingsDigest!==backend.beforeLive.settingsDigest)throw Error('Activated backend differs from the qualified planned backend');
    const deployments=jobs.jobs.filter(job=>job.name==='deploy'&&job.run_id===run.id&&job.run_attempt===run.run_attempt&&job.head_sha===proof.orchestration);
    if(deployments.length!==1)throw Error('Exact backend activation job required');
    const steps=deployments[0].steps||[],records=steps.filter(step=>step.name==='Record the actual qualified active Worker and configuration'&&step.status==='completed'&&step.conclusion==='success'),
      stamps=steps.filter(step=>step.name==='verified-release-backend-'+sha256(currentBackend)&&step.status==='completed'&&step.conclusion==='success'),
      archives=steps.filter(step=>step.name==='Preserve the activated Worker checkpoint before frontend writes'&&step.status==='completed'&&step.conclusion==='success');
    if(records.length!==1||stamps.length!==1||archives.length!==1||!(records[0].number<stamps[0].number&&stamps[0].number<archives[0].number))throw Error('Exact attested and archived backend activation required');
  }
  return true;
}
async function recoveryMetadata(url){
  const response=await fetch(url,{method:'GET',cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Rollback qualification metadata unavailable');
  const reader=response.body.getReader(),chunks=[];let total=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>1024*1024)throw Error('Unbounded rollback qualification metadata');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(Buffer.concat(chunks,total));
}
export async function publicationCommand(command,{root=process.cwd(),env=process.env,runner=execute,store,approval,verifyTarget,metadata=recoveryMetadata,contractReader=rollbackPairContracts}={}){
  if(command==='prepare')return preparePublication({root,env});
  if(!['stage','bootstrap','promote','verify','check-staged','inspect','resume','rollback'].includes(command))throw Error('Use prepare, stage, bootstrap, promote, verify, check-staged, inspect, resume or rollback');
  const {candidate,previous,context,originEnv,backend}=await preservedPublication({root,env});
  if(['resume','rollback'].includes(command)&&!approval)throw Error('Exact per-action recovery approval required');
  const manual=['resume','rollback'].includes(command)||(command==='promote'&&approval);
  const expected=await readJSON(join(root,DIRECTORY,manual?'observed-pointer.json':'expected-pointer.json'));
  if(command==='resume'||command==='rollback'||(command==='promote'&&approval))checkedActionApproval(approval,{action:command,context,candidate,previous,expected});
  else if(!['verify','inspect','check-staged'].includes(command)&&(env.GITHUB_REPOSITORY!=='braydenparker000/Missionarytube-'||env.GITHUB_REF!=='refs/heads/main'||
    String(env.GITHUB_RUN_ID)!==candidate.plan.proof.identity.runId||String(env.GITHUB_RUN_ATTEMPT)!==candidate.plan.proof.identity.attempt))throw Error('Exact authorized main deployment run required');
  store??=azureStaticStore({env,runner,temporary:join(root,DIRECTORY,'transport')});
  if(command==='inspect'){
    const live=await store.get(POINTER);recognizedPointer(live,{candidate,previous,allowMissing:context.initial});
    const observation={etag:live?.etag??null,sha256:live?sha256(live.bytes):null};
    await saveJSON(join(root,DIRECTORY,'observed-pointer.json'),observation);
    return {phase:'inspected',expectedPointer:observation};
  }
  const guard=async()=>{
    recognizedPointer(await store.get(POINTER),{candidate,previous,allowMissing:context.initial});
    for(const args of [['scripts/qualified-artifact.mjs','verify-configured'],['scripts/worker-release-identity.mjs','verify'],['scripts/check-jarvis-api.mjs']]){
      try{await runner(process.execPath,args,{cwd:root,env:originEnv,timeout:30*60*1000,maxBuffer:1024*1024,killSignal:'SIGKILL'});}catch{throw Error('Required artifact, actual backend or readiness check failed');}
    }
    if(command==='resume'||command==='rollback'||(command==='promote'&&approval)){
      const directory=await mkdtemp(join(root,DIRECTORY,'readiness-'));
      try{
        for(const name of ['home','config','azure'])await mkdir(join(directory,name),{mode:0o700});
        const lane=prewriteLanes({root,env:{...originEnv,PODCASTS_ENABLED:'true'},readinessDirectory:directory})[0];
        await runner(lane.binary,lane.args,{cwd:root,env:lane.env,timeout:lane.timeout,maxBuffer:1024*1024,killSignal:'SIGKILL'});
      }catch{throw Error('Fresh isolated podcast readiness failed');}finally{await rm(directory,{recursive:true,force:true});}
    }
    if(['stage','resume','bootstrap','promote','rollback'].includes(command)){
      const proof=await readJSON(join(root,DIRECTORY,'rollback-compatibility.json'));
      if(!/^[1-9][0-9]{0,14}$/.test(proof.runId||'')||!/^[1-9][0-9]{0,5}$/.test(proof.attempt||''))throw Error('Exact rollback qualification locator required');
      if(proof.orchestration!==context.orchestration||!/^[a-f0-9]{40}$/.test(proof.orchestration||''))throw Error('Exact rollback orchestration required');
      const [run,jobs,tree]=await Promise.all([metadata('https://api.github.com/repos/braydenparker000/Missionarytube-/actions/runs/'+proof.runId),
        metadata('https://api.github.com/repos/braydenparker000/Missionarytube-/actions/runs/'+proof.runId+'/attempts/'+proof.attempt+'/jobs?per_page=100'),
        metadata('https://api.github.com/repos/braydenparker000/Missionarytube-/git/trees/'+proof.orchestration+'?recursive=1')]);
      checkedRollbackPair(proof,{candidate,previous,context,backend,contracts:await contractReader({root,previous,backend}),currentBackend:await readJSON(join(root,'worker-identity-current.json')),
        run,jobs,tree,recipe:backend.candidate.recipe,promotion:!approval});
    }
  };
  const checkpoint=async value=>saveJSON(join(root,DIRECTORY,'state.json'),boundedEvidence({...value,releaseId:value.releaseId??candidate.plan.releaseId,artifactDigest:context.artifactDigest,backupDigest:context.backupDigest,checks:[]}));
  if(command==='stage'||command==='resume'){
    await guard();if(context.initial)await stageRelease(previous,store,{checkpoint});const result=await stageRelease(candidate,store,{checkpoint});
    if(command==='resume'&&context.initial){
      const active=await store.get(POINTER),selected=active&&sha256(active.bytes)===sha256(JSON.stringify(candidate.plan.pointer)+'\n');
      if(selected)return {...result,phase:'selected',verificationRequired:true};
      previous.original=await readTree(join(root,'rollback/files'));await installLoaders(previous,candidate,store,{guard,checkpoint});
      const live=await store.get(POINTER);if(recognizedPointer(live,{candidate,previous})!=='previous')throw Error('Bootstrap completion selected a foreign release');
      await saveJSON(join(root,DIRECTORY,'expected-pointer.json'),{etag:live.etag,sha256:sha256(live.bytes)});
    }
    return result;
  }
  if(command==='bootstrap'){
    if(!context.initial){await guard();recognizedPointer(await store.get(POINTER),{candidate,previous});await verifyRelease(previous,store,{canonical:true});return {phase:'bootstrap',existing:true};}
    previous.original=await readTree(join(root,'rollback/files'));
    await installLoaders(previous,candidate,store,{guard,checkpoint});
    const live=await store.get(POINTER);if(recognizedPointer(live,{candidate,previous})!=='previous')throw Error('Bootstrap completion selected a foreign release');
    await saveJSON(join(root,DIRECTORY,'expected-pointer.json'),{etag:live.etag,sha256:sha256(live.bytes)});
    return {phase:'bootstrap',releaseId:previous.plan.releaseId};
  }
  if(command==='promote'||command==='rollback'){
    recognizedPointer(await store.get(POINTER),{candidate,previous});
    return switchPointer(command==='rollback'?previous:candidate,store,{expected,guard,checkpoint});
  }
  if(command==='check-staged'){await verifyRelease(candidate,store);return {phase:'staged',releaseId:candidate.plan.releaseId};}
  const state=await readJSON(join(root,DIRECTORY,'state.json'));
  const targetName=verifyTarget??(['selected','verified'].includes(state.phase)&&state.releaseId===previous.plan.releaseId?'previous':'candidate');
  if(!['candidate','previous'].includes(targetName))throw Error('Explicit candidate or previous verification target required');
  const target=targetName==='previous'?previous:candidate;await verifyRelease(target,store,{canonical:true});
  await guard();
  const live=await store.get(POINTER),bytes=Buffer.from(JSON.stringify(target.plan.pointer)+'\n');
  if(recognizedPointer(live,{candidate,previous})!==targetName)throw Error('Final active pointer differs from verification target');
  await checkpoint({phase:'verified',releaseId:target.plan.releaseId});return {phase:'verified',releaseId:target.plan.releaseId,publicationDigest:sha256(target.plan),pointerDigest:sha256(bytes)};
}
export async function preservedPublication({root=process.cwd(),env=process.env}={}){
  const [candidate,previous,context]=await Promise.all([loadPublication(join(root,DIRECTORY,'candidate')),loadPublication(join(root,DIRECTORY,'previous')),readJSON(join(root,DIRECTORY,'context.json'))]);
  // Normal execution is bound to this exact run/attempt/head; a recovery uses
  // original qualified artifacts and explicit action approval, never a rebuild.
  const originEnv={...env,GITHUB_RUN_ID:candidate.plan.proof.identity.runId,GITHUB_RUN_ATTEMPT:candidate.plan.proof.identity.attempt};
  const current=await sealedCandidate(root,originEnv);
  const saved=await readJSON(join(root,'rollback/verified-backup.json')),manifest=await readJSON(join(root,'rollback/manifest.json'));
  const backupFiles=await verifyBackupFiles(manifest,join(root,'rollback/files'));
  if(sha256(current.plan)!==sha256(candidate.plan)||context.releaseId!==candidate.plan.releaseId||context.previousReleaseId!==previous.plan.releaseId||
    context.orchestration!==candidate.plan.proof.identity.orchestration||context.artifactDigest!==candidate.plan.proof.artifactDigest||
    context.backendIdentityDigest!==candidate.plan.proof.backendIdentityDigest||context.backupDigest!==sha256(saved)||
    saved.account!=='missionarytube'||saved.container!=='$web'||!isDeepStrictEqual(saved.files,backupFiles))throw Error('Preserved release evidence changed');
  // A self-consistent plan is not enough: bind the previous release back to
  // the independently preserved complete backup before any provider action.
  const backup=await readTree(join(root,'rollback/files'));
  if(context.initial){
    if(backup.has(POINTER))throw Error('Initial backup unexpectedly contains a pointer');
    const frozen=buildPublication(backup,{proof:{kind:'verified-static-backup',backupDigest:sha256(saved)},recipe:candidate.plan.recipe,loader:await readFile(join(root,'scripts/static-release-loader.js'))});
    if(sha256(frozen.plan)!==sha256(previous.plan))throw Error('Previous publication differs from verified static backup');
  }else{
    const bytes=backup.get(POINTER),plan=JSON.parse(backup.get(ROOT+previous.plan.releaseId+'/'+RELEASE_MANIFEST)||'null');
    if(!bytes||!plan||!isDeepStrictEqual(JSON.parse(bytes),previous.plan.pointer)||sha256(plan)!==sha256(previous.plan))throw Error('Previous publication differs from verified static backup');
    for(const [path,bytes] of previous.payload)if(sha256(backup.get(ROOT+previous.plan.releaseId+'/'+path))!==sha256(bytes))throw Error('Previous immutable bytes differ from verified static backup');
    for(const [path,bytes] of previous.canonical)if(sha256(backup.get(path))!==sha256(bytes))throw Error('Previous canonical bytes differ from verified static backup');
  }
  return {candidate,previous,context,originEnv,backend:await readJSON(join(root,'worker-identity-planned.json'))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const [command,...args]=process.argv.slice(2);let approval,verifyTarget;
    while(args.length){const flag=args.shift(),value=args.shift();if(flag==='--approval-file'&&!approval&&value)approval=await readJSON(resolve(value));else if(flag==='--target'&&command==='verify'&&!verifyTarget&&value)verifyTarget=value;else throw Error('Invalid publication arguments');}
    console.log(JSON.stringify(await publicationCommand(command,{approval,verifyTarget})));
  }catch{console.error('Versioned publication stopped; preserve the exact artifacts and inspect bounded recovery evidence.');process.exitCode=1;}
}
