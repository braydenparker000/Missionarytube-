// Local candidate evidence only. This entry point never calls provider clients,
// emits a production pair record, changes a release pin or authorizes promotion.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,symlink} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {schemaAt,rollbackPairContracts,ADVERSARIAL_TESTS} from './rollback-pair-contracts.mjs';
import {fileManifest,checkedManifest} from './qualified-artifact.mjs';
import {readTree,inventory,buildPublication,savePublication,compatibleLoaders,sha256} from './static-publication.mjs';
import {runPairRuntime} from './rollback-pair-runtime.mjs';
import {podcastCanonicalContract,derivedPodcastView,qualifyCanonicalChain} from './podcast-canonical-migration.mjs';

const execute=promisify(execFile),LIVE='c4d62409a3b67e4e5dac88809c6a4a0290b6e39e';
const PRODUCER='6485e1f3fbc919d3977eeffdc110db225d148490',PR_CHECKOUT='318974ac3b4013d1e4156a87caaa88eea9735df4';
const BASELINES=Object.freeze([
  {source:LIVE,kind:'historical-pr-qualified-artifact',artifactId:11597366865,runId:'37888096033',attempt:'1',prHead:PRODUCER,checkout:PR_CHECKOUT,
    zipSha256:'002dacaf331f2a5f55c0ba347fd10ed00df72a4de5b19a48f7307f9d57167686'},
  {source:'f999581aa979712b4b63a6783b7c56842fedb6a1',kind:'current-main-qualified-artifact',artifactId:11599059865,runId:'37894308237',attempt:'1',
    checkout:'9c01243ad03b921a0b0614d5eb003944a2807a6c',zipSha256:'c2d8abe103d35ae3d2b7bb36c9483a6bd3bb089ed1c625cc2f1e0972a8f91fc1'},
]);
const TRANSPORT=['PATH','TMPDIR','TMP','TEMP','LANG','LC_ALL','TZ'];
const json=async path=>JSON.parse(await readFile(path,'utf8'));
export async function prepareLocalCorePair({root=process.cwd(),artifactZip,candidate,node22,baseline,chrome=process.env.JARVIS_CHROME,podcastMigration=false}={}){
  assert.equal(process.version,'v24.21.0','Use the exact qualified local runtime');
  assert.match(candidate||'',/^[a-f0-9]{40}$/);
  assert.ok(artifactZip&&node22&&baseline,'Exact remote baseline artifact, clean baseline checkout and qualified builder are required');
  root=resolve(root);artifactZip=resolve(artifactZip);node22=resolve(node22);baseline=resolve(baseline);
  const zipDigest=sha256(await readFile(artifactZip)),baselineIdentity=BASELINES.find(item=>item.zipSha256===zipDigest);
  assert.ok(baselineIdentity,'Remote baseline artifact digest is not reviewed');
  const previousSource=baselineIdentity.source;assert.notEqual(candidate,previousSource,'The pair requires distinct source commits');
  const source=join(root,'.jarvis-source');
  assert.ok(!baseline.startsWith(root+'/'),'Keep external baseline tooling outside the qualified checkout');
  const git=async(cwd,...args)=>(await execute('git',['-C',cwd,...args],{timeout:10000,maxBuffer:2*1024*1024})).stdout.trim();
  assert.equal(await git(source,'rev-parse','HEAD'),candidate);assert.equal(await git(baseline,'rev-parse','HEAD'),previousSource);
  for(const checkout of [root,source,baseline])assert.equal(await git(checkout,'status','--porcelain','--untracked-files=no'),'','Tracked source/recipe edits are refused');
  await git(root,'ls-files','--error-unmatch','scripts/prepare-core-rollback-pair.mjs');
  assert.equal((await execute(node22,['--version'])).stdout.trim(),'v22.23.3');
  assert.equal(await git(root,'rev-parse',PRODUCER+'^{tree}'),await git(root,'rev-parse',PR_CHECKOUT+'^{tree}'),'The hosted PR checkout tree must match its reviewed branch');
  const output=await mkdtemp(join(dirname(root),basename(root)+'-evidence-'));
  const isolated={...Object.fromEntries(TRANSPORT.filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]))};
  for(const name of ['home','config','azure'])await mkdir(join(output,name),{mode:0o700});
  Object.assign(isolated,{HOME:join(output,'home'),XDG_CONFIG_HOME:join(output,'config'),AZURE_CONFIG_DIR:join(output,'azure'),...(chrome?{JARVIS_CHROME:chrome,CHROMIUM_PATH:chrome}:{}),REQUIRE_RELAY_OWNER_BROWSER:'1'});
  const report={schema:1,kind:'local-candidate-only',orchestration:await git(root,'rev-parse','HEAD'),reviewedProducer:PRODUCER,
    sourcePair:{previous:previousSource,candidate},sourceTrees:{previous:await git(source,'rev-parse',previousSource+'^{tree}'),candidate:await git(source,'rev-parse',candidate+'^{tree}')},
    baselineArtifact:{repository:'braydenparker000/Missionarytube-',...baselineIdentity},
    integratedMainProof:false,productionPairRecordEmitted:false,actualPreviousStaticBackupVerified:false,actualPreviousWorkerVerified:false,providerRestoreVerified:false,productionOperations:0,
    qualification:{schema:'pending',sourceAdversarial:'pending',runtime:'pending'},status:'preparing'};
  const checkpoint=()=>writeFile(join(output,'candidate-evidence.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  try{
    await execute('python3',['-c',`import pathlib,stat,sys,zipfile
root=pathlib.Path(sys.argv[2]);total=0
with zipfile.ZipFile(sys.argv[1]) as archive:
 if len(archive.infolist())>1024:raise ValueError('Unbounded artifact inventory')
 for item in archive.infolist():
  path=pathlib.PurePosixPath(item.filename)
  if path.is_absolute() or '..' in path.parts or stat.S_ISLNK(item.external_attr>>16):raise ValueError('Unsafe artifact member')
  total+=item.file_size
  if total>67108864:raise ValueError('Unbounded artifact bytes')
  destination=root.joinpath(*path.parts)
  if item.is_dir():destination.mkdir(parents=True,exist_ok=True)
  else:destination.parent.mkdir(parents=True,exist_ok=True);destination.write_bytes(archive.read(item))
`,artifactZip,join(output,'remote-baseline')],{env:isolated,timeout:30000,maxBuffer:1024*1024});
    const seal=await json(join(output,'remote-baseline/qualified-artifact.json')),oldFiles=await readTree(join(output,'remote-baseline/dist'));
    assert.equal(seal.identity.source,previousSource);assert.equal(seal.identity.orchestration,baselineIdentity.checkout);assert.equal(seal.identity.runId,baselineIdentity.runId);assert.equal(seal.identity.attempt,baselineIdentity.attempt);
    checkedManifest(seal,seal.identity,await fileManifest(join(output,'remote-baseline/dist')));
    report.baselineArtifact.identity=seal.identity;report.baselineArtifact.inputDigest=sha256(inventory(oldFiles));
    const [liveSchema,previousSchema]=await Promise.all([schemaAt(source,LIVE),schemaAt(source,previousSource)]);
    assert.deepEqual(previousSchema,liveSchema,'The current frontend source must have the exact c4 schema contract');
    assert.equal(await git(source,'ls-tree','-r',previousSource,'backend'),await git(source,'ls-tree','-r',LIVE,'backend'),'The current frontend source must preserve the complete c4 backend tree');
    report.baselineSchema={source:previousSource,backendSource:LIVE,identicalSchemaInputs:true,identicalBackendFiles:true,statements:previousSchema.length,digest:sha256(previousSchema)};
    const release=await json(join(root,'jarvis-release.json'));
    assert.equal(release.repository,'braydenparker999/jarvis');assert.equal(release.commit,LIVE);
    const buildRecipes=['scripts/build-jarvis.mjs','scripts/r2-player-config.mjs'];
    for(const [name,checkout,commit] of [['baseline',baseline,previousSource],['candidate',source,candidate]]){
      const build=join(output,'build-'+name);await mkdir(join(build,'scripts'),{recursive:true});
      for(const path of buildRecipes){
        const immutable=(await execute('git',['-C',root,'show',PRODUCER+':'+path],{encoding:'buffer'})).stdout;
        assert.deepEqual(await readFile(join(root,path)),immutable,'Use the original reviewed build recipe');await copyFile(join(root,path),join(build,path));
      }
      await writeFile(join(build,'jarvis-release.json'),JSON.stringify({...release,commit})+'\n');await symlink(checkout,join(build,'.jarvis-source'),'dir');
      await execute(node22,['scripts/build-jarvis.mjs'],{cwd:build,env:isolated,timeout:30000,maxBuffer:1024*1024});
    }
    const rebuilt=await readTree(join(output,'build-baseline/dist'));assert.deepEqual(inventory(rebuilt),inventory(oldFiles),'Original reviewed build must reproduce the complete remote qualified baseline artifact');
    const candidateFiles=await readTree(join(output,'build-candidate/dist'));assert.equal(JSON.parse(candidateFiles.get('release.json')).commit,candidate);
    report.buildRecipeDigest=sha256(await Promise.all(buildRecipes.map(async path=>({path,sha256:sha256(await readFile(join(root,path)))}))));
    report.candidateArtifact={kind:'local-source-build',files:inventory(candidateFiles),inputDigest:sha256(inventory(candidateFiles))};
    const loader=await readFile(join(root,'scripts/static-release-loader.js')),recipe=sha256({reviewedProducer:PRODUCER,buildRecipeDigest:report.buildRecipeDigest});
    const rawProof={kind:baselineIdentity.kind,identity:seal.identity};
    let previousFiles=oldFiles,previousProof=rawProof;
    if(podcastMigration){
      const contract=podcastCanonicalContract(oldFiles,candidateFiles,{sourcePair:report.sourcePair,artifactSha256:zipDigest});
      const helperDigest=sha256(await readFile(join(root,'scripts/podcast-canonical-migration.mjs')));
      previousFiles=derivedPodcastView(contract);previousProof={kind:'derived-compatibility-view',rawProof,migrationDigest:contract.digest,helperDigest};
      report.canonicalMigration={...contract.envelope,digest:contract.digest,helperDigest,
        qualification:await qualifyCanonicalChain(contract,{loader,recipe,rawProof,derivedProof:previousProof,candidateProof:{kind:'local-candidate-only',source:candidate,orchestration:report.orchestration}})};
      const raw=buildPublication(oldFiles,{proof:rawProof,recipe,loader});await savePublication(raw,join(output,'raw-previous'));
      report.rawPrevious={files:174,inputDigest:raw.plan.inputDigest,releaseId:raw.plan.releaseId};
      await writeFile(join(output,'canonical-migration.json'),JSON.stringify(report.canonicalMigration,null,2)+'\n');
    }
    const previous=buildPublication(previousFiles,{proof:previousProof,recipe,loader});
    const next=buildPublication(candidateFiles,{proof:{kind:'local-candidate-only',source:candidate,orchestration:report.orchestration},recipe,loader});
    compatibleLoaders(previous,next);
    if(podcastMigration){assert.equal(report.canonicalMigration.qualification.rawReleaseId,report.rawPrevious.releaseId);assert.equal(report.canonicalMigration.qualification.derivedReleaseId,previous.plan.releaseId);assert.equal(report.canonicalMigration.qualification.candidateReleaseId,next.plan.releaseId);}
    for(const [name,publication] of [['previous',previous],['candidate',next]])await savePublication(publication,join(output,name));
    report.publications={previous:{releaseId:previous.plan.releaseId,digest:sha256(previous.plan)},candidate:{releaseId:next.plan.releaseId,digest:sha256(next.plan)}};
    const contracts=await rollbackPairContracts({root,previous,backend:{candidate:{source:candidate}}});
    report.contracts={schemaInputsDigest:contracts.schemaInputsDigest,pendingRuntimeDigest:contracts.pendingRuntimeDigest,runtimeRecipeDigest:contracts.runtimeRecipeDigest,
      previousStatements:contracts.before.length,candidateStatements:contracts.after.length};
    for(const [name,rows] of [['live',contracts.before],['candidate',contracts.after]])await writeFile(join(output,name+'-schema.sql'),rows.map(row=>row.sql).join('\n'));
    report.schema=JSON.parse((await execute('python3',[join(root,'tests/fixtures/release-recovery/schema-recovery.py'),output],{env:isolated,timeout:30000,maxBuffer:1024*1024})).stdout);
    assert.equal(report.schema.ddlInterruptionPoints,contracts.after.length+1);report.qualification.schema='pass';await checkpoint();
    const adversarial=await execute(process.execPath,['--test','--test-reporter=tap',...ADVERSARIAL_TESTS],{cwd:source,env:isolated,timeout:240000,maxBuffer:8*1024*1024});
    assert.match(adversarial.stdout,/^# fail 0\s*$/m);assert.match(adversarial.stdout,/^# skipped 0\s*$/m);await writeFile(join(output,'source-adversarial.tap'),adversarial.stdout);
    report.qualification.sourceAdversarial='pass';report.sourceAdversarialTests=Number(adversarial.stdout.match(/^# tests (\d+)\s*$/m)[1]);
    if(chrome){
      report.runtime=await runPairRuntime({source,previousDirectory:join(output,'previous'),candidateDirectory:join(output,'candidate'),schemaDirectory:output,chrome});
      report.qualification.runtime='pass';report.status='candidate-fixtures-pass';
    }else report.status='awaiting-exact-browser';
    await checkpoint();return {output,report};
  }catch(error){report.status='blocked';report.failure={name:error.name};await checkpoint();throw Object.assign(Error('Local exact candidate preparation blocked; evidence retained at '+output),{cause:error,output});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{const [artifactZip,candidate,node22,baseline,option]=process.argv.slice(2);assert.ok(option===undefined||option==='--podcast-migration','Unsupported local option');const result=await prepareLocalCorePair({artifactZip,candidate,node22,baseline,podcastMigration:option==='--podcast-migration'});console.log(JSON.stringify({output:result.output,status:result.report.status,integratedMainProof:false,productionOperations:0}));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
