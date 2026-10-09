import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp,mkdir,rm,rename,appendFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {preservedPublication,checkedRollbackPair} from './publish-jarvis-versioned.mjs';
import {rollbackPairContracts,ADVERSARIAL_TESTS} from './rollback-pair-contracts.mjs';
import {recoveryPairRecord,checkedPairRecord} from './rollback-pair-proof.mjs';
import {sha256} from './static-publication.mjs';
import {azureStaticStore} from './azure-static-store.mjs';
import {checkedBackupSnapshot} from './backup-jarvis-storage.mjs';
import {prewriteLanes} from './overlap-jarvis-prewrite.mjs';

const execute=promisify(execFile),REPO='braydenparker000/Missionarytube-';
const readJSON=async path=>JSON.parse(await readFile(path,'utf8'));
const RUNTIME_ENV=['PATH','TMPDIR','TMP','TEMP','LANG','LC_ALL','TZ'];
async function publicMetadata(url){
  const response=await fetch(url,{cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(20000)});
  if(response.status!==200)throw Error('Immutable qualification metadata unavailable');
  const reader=response.body.getReader(),chunks=[];let count=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>1024*1024)throw Error('Unbounded qualification metadata');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(Buffer.concat(chunks,count));
}
export async function hostedPairProof(inputs,{root,metadata=publicMetadata,currentBackend,prewrite=false,forward=false}={}){
  const proof=await readJSON(join(root,'.publication/rollback-compatibility.json'));
  checkedPairRecord(proof,inputs);
  if(!/^[1-9][0-9]{0,14}$/.test(proof.runId||'')||!/^[1-9][0-9]{0,5}$/.test(proof.attempt||'')||!/^[a-f0-9]{40}$/.test(proof.orchestration||''))throw Error('Exact hosted proof locator required');
  const [run,jobs,tree]=await Promise.all([metadata('https://api.github.com/repos/'+REPO+'/actions/runs/'+proof.runId),
    metadata('https://api.github.com/repos/'+REPO+'/actions/runs/'+proof.runId+'/attempts/'+proof.attempt+'/jobs?per_page=100'),
    metadata('https://api.github.com/repos/'+REPO+'/git/trees/'+proof.orchestration+'?recursive=1')]);
  checkedRollbackPair(proof,{...inputs,currentBackend,run,jobs,tree,recipe:inputs.backend.candidate.recipe,promotion:forward,prewrite});
  return proof;
}
function exactMain(inputs,env){
  const identity=inputs.candidate.plan.proof.identity;
  if(env.GITHUB_REPOSITORY!==REPO||env.GITHUB_REF!=='refs/heads/main'||String(env.GITHUB_RUN_ID)!==identity.runId||String(env.GITHUB_RUN_ATTEMPT)!==identity.attempt)throw Error('Exact main prewrite qualification required');
}
export async function verifyStaticBaseline(root,store){
  const manifest=await readJSON(join(root,'rollback/manifest.json')),files=(await readJSON(join(root,'rollback/verified-backup.json'))).files;
  for(const file of files){
    const actual=await store.get(file.path),entry=manifest.find(item=>item.name===file.path);
    if(!entry||!actual||actual.etag!==entry.properties.etag||actual.bytes.length!==file.bytes||sha256(actual.bytes)!==file.sha256||
      actual.contentType.split(';')[0].trim().toLowerCase()!==entry.properties.contentSettings.contentType.split(';')[0].trim().toLowerCase())throw Error('Live static baseline changed after its complete backup');
  }
}
export async function rollbackPairCommand(command,{root=process.cwd(),env=process.env,runner=execute,store,metadata=publicMetadata,evidenceReader=preservedPublication,contractReader=rollbackPairContracts,runtimeVersion=process.version}={}){
  if(!['produce','verify-local','authorize-change'].includes(command))throw Error('Use produce, verify-local or authorize-change');
  const inputs=await evidenceReader({root,env});exactMain(inputs,env);inputs.contracts=await contractReader({...inputs,root});
  const release=await readJSON(join(root,'jarvis-release.json'));
  if(release.deployPodcastWorker!==true||release.preserveDriveCatalog!==true)throw Error('Unsupported backend/catalog migration requires separate review');
  const check=async args=>{
    try{return await runner(process.execPath,args,{cwd:root,env,timeout:30*60*1000,maxBuffer:8*1024*1024,killSignal:'SIGKILL'});}catch{throw Error('Required prewrite identity or readiness check failed');}
  };
  await check(['scripts/qualified-artifact.mjs','verify-configured']);await check(['scripts/worker-release-identity.mjs','verify-planned']);
  if(command==='verify-local'){
    const proof=await readJSON(join(root,'.publication/rollback-compatibility.json'));checkedPairRecord(proof,inputs);
    if(proof.pairDigest!==env.EXPECTED_PAIR_DIGEST)throw Error('Producer digest differs from its immutable verification stamp');
    return {pairDigest:proof.pairDigest};
  }
  store??=azureStaticStore({env,runner,temporary:join(root,'.publication/proof-transport')});
  if(command==='authorize-change'){
    const proof=await hostedPairProof(inputs,{root,metadata,prewrite:true,forward:true});
    const original=await readJSON(join(root,'rollback/manifest.json'));
    let actual;try{actual=JSON.parse((await runner('az',['storage','blob','list','--account-name','missionarytube','--auth-mode','login','--container-name','$web','--output','json','--only-show-errors'],{cwd:root,env,timeout:30000,maxBuffer:32*1024*1024,killSignal:'SIGKILL'})).stdout);}catch{throw Error('Authenticated complete prewrite inventory unavailable');}
    checkedBackupSnapshot(original,actual);await verifyStaticBaseline(root,store);
    await check(['scripts/worker-release-identity.mjs','verify-planned']);return {pairDigest:proof.pairDigest,providerChangesAuthorized:true};
  }
  if(runtimeVersion!=='v24.21.0'||!env.JARVIS_CHROME)throw Error('Exact qualified runtime and browser required');
  await rm(join(root,'.publication/rollback-compatibility.json'),{force:true});
  await verifyStaticBaseline(root,store);
  const temporary=await mkdtemp(join(root,'.publication/pair-fixture-'));
  try{
    for(const name of ['home','config','azure'])await mkdir(join(temporary,name),{mode:0o700});
    const isolated={...Object.fromEntries(RUNTIME_ENV.filter(key=>env[key]!==undefined).map(key=>[key,env[key]])),HOME:join(temporary,'home'),XDG_CONFIG_HOME:join(temporary,'config'),AZURE_CONFIG_DIR:join(temporary,'azure'),JARVIS_CHROME:env.JARVIS_CHROME,CHROMIUM_PATH:env.JARVIS_CHROME,REQUIRE_RELAY_OWNER_BROWSER:'1'};
    for(const [name,rows] of [['live',inputs.contracts.before],['candidate',inputs.contracts.after]])await writeFile(join(temporary,name+'-schema.sql'),rows.map(row=>row.sql).join('\n'),{mode:0o600});
    let schema,runtime;
    try{
      const result=await runner('python3',[join(root,'tests/fixtures/release-recovery/schema-recovery.py'),temporary],{cwd:root,env:isolated,timeout:30000,maxBuffer:1024*1024,killSignal:'SIGKILL'});
      schema=JSON.parse(result.stdout);delete schema.schema;
      if(schema.ddlInterruptionPoints!==inputs.contracts.after.length+1)throw Error();
      await runner(process.execPath,[join(root,'scripts/rollback-pair-runtime.mjs'),join(root,'.jarvis-source'),join(root,'.publication/previous'),join(root,'.publication/candidate'),temporary,join(temporary,'runtime.json')],{cwd:root,env:isolated,timeout:240000,maxBuffer:1024*1024,killSignal:'SIGKILL'});
      runtime=await readJSON(join(temporary,'runtime.json'));
      const adversarial=await runner(process.execPath,['--test','--test-reporter=tap',...ADVERSARIAL_TESTS],{cwd:join(root,'.jarvis-source'),env:isolated,timeout:240000,maxBuffer:8*1024*1024,killSignal:'SIGKILL'});
      if(!/^# fail 0\s*$/m.test(adversarial.stdout)||!/^# skipped 0\s*$/m.test(adversarial.stdout))throw Error();
    }catch{throw Error('Executed schema, pending-work or exact-artifact browser compatibility failed');}
    const lane=prewriteLanes({root,env:{...env,PODCASTS_ENABLED:'true'},readinessDirectory:temporary})[0];
    try{await runner(lane.binary,lane.args,{cwd:root,env:lane.env,timeout:lane.timeout,maxBuffer:1024*1024,killSignal:'SIGKILL'});}catch{throw Error('Fresh isolated public readiness failed');}
    await check(['scripts/check-jarvis-api.mjs']);await check(['scripts/worker-release-identity.mjs','verify-planned']);await verifyStaticBaseline(root,store);
    const proof=recoveryPairRecord(inputs,{schema,runtime,sourceAdversarialTests:'pass'});
    const path=join(root,'.publication/rollback-compatibility.json');await writeFile(path+'.tmp',JSON.stringify(proof,null,2)+'\n',{mode:0o600});await rename(path+'.tmp',path);
    return {pairDigest:proof.pairDigest};
  }finally{await rm(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{const result=await rollbackPairCommand(process.argv[2]);if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'digest='+result.pairDigest+'\n');console.log(JSON.stringify(result));}
  catch{console.error('Exact rollback-pair prewrite qualification stopped; no provider change is authorized.');process.exitCode=1;}
}
