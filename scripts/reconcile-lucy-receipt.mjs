import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readWorkerSettings} from './check-music-worker-bindings.mjs';
import {liveIdentity,settingsDigest,receiptDigest} from './worker-release-identity.mjs';
import {relayCandidateIdentity,checkedRelayFullReleasePolicy,canonicalSettingsDigest,LUCY_RECEIPT_MODE} from './relay-worker-release-identity.mjs';
import {checkedCheckpoint,compareBindings} from './lucy-settings-diagnostic.mjs';
import {fileManifest,checkedManifest,CONFIGURATION_FILES} from './qualified-artifact.mjs';

const REPO='braydenparker000/Missionarytube-',API='https://api.github.com/repos/'+REPO;
const ORIGIN='https://missionarytube.z13.web.core.windows.net';
const VERSION='373ce184-a738-428f-b2c9-3088f9f75336';
const PRIOR_RECEIPT='069b5c96904dfaa6bf0e24e157b9c3c3f3719ee2d7b2c0201a429cc8df864b9a';
const FRONT_SOURCE='363f710068bb6f2c456dbbf183f063484a36fe11';
const FRONT_HEAD='40835db24e9036a33d26f9a57e7c8c9851ec1208';
const DIR='.lucy-reconcile';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{safeCode:code});};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export async function bytes(url,{fetcher=globalThis.fetch,token=process.env.GITHUB_TOKEN}={}){
  const initial=new URL(url),github=initial.origin==='https://api.github.com';
  const operation=github?(initial.pathname.endsWith('/zip')?'artifact_archive':initial.pathname.includes('/artifacts/')?'artifact_metadata':initial.pathname.endsWith('/jobs')?'run_jobs':'run_metadata'):'frontend_bytes';
  let target=initial;
  for(let hop=0;hop<4;hop++){
    const headers=github&&hop===0?{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:'Bearer '+token}:{})}:{};
    let response;
    try{response=await fetcher(target.href,{method:'GET',redirect:'manual',headers,cache:'no-store',signal:AbortSignal.timeout(60000)});}
    catch{fail(operation+'_transport_failed');}
    if(github||!response.ok)console.log(JSON.stringify({operation,hop,status:response.status}));
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get('location');if(!location)fail(operation+'_redirect_missing');
      try{target=new URL(location,target);}catch{fail(operation+'_redirect_invalid');}
      if(target.protocol!=='https:'||target.username||target.password)fail(operation+'_redirect_unsafe');
      continue;
    }
    if(!response.ok)fail(operation+'_http_'+response.status);
    const data=Buffer.from(await response.arrayBuffer());if(data.length>40*1024*1024)fail('read_too_large');return data;
  }
  fail(operation+'_redirect_limit');
}
const json=async url=>JSON.parse((await bytes(url)).toString('utf8'));
const local=async path=>JSON.parse(await readFile(path,'utf8'));
async function checkedRun(id,head,path,conclusion,event='push'){
  const run=await json(`${API}/actions/runs/${id}`);
  if(run.head_sha!==head||run.run_attempt!==1||run.event!==event||run.head_branch!=='main'||run.status!=='completed'||run.conclusion!==conclusion||
    run.path!==path||run.repository?.full_name!==REPO||run.head_repository?.full_name!==REPO||run.head_repository?.fork===true)fail('run_provenance_mismatch');
  const jobs=await json(`${API}/actions/runs/${id}/attempts/1/jobs?per_page=100`);
  if(!Array.isArray(jobs.jobs)||jobs.total_count!==jobs.jobs.length||jobs.jobs.some(job=>job.run_id!==id||job.run_attempt!==1||job.head_sha!==head||job.status!=='completed'))fail('job_provenance_incomplete');return jobs.jobs;
}
async function artifact(id,name,digest,run,directory){
  const metadata=await json(`${API}/actions/artifacts/${id}`);
  if(metadata.id!==id||metadata.name!==name||metadata.digest!=='sha256:'+digest||metadata.expired||metadata.workflow_run?.id!==run)fail('artifact_provenance_mismatch');
  // Use only the existing token permissions. Never log
  // the temporary redirect URL. Verify the archive before extracting any file.
  const archive=await bytes(`${API}/actions/artifacts/${id}/zip`);
  if(hash(archive)!==digest)fail('artifact_digest_mismatch');
  await mkdir(directory,{recursive:true});const path=directory+'.zip';await writeFile(path,archive);
  execFileSync('unzip',['-q',path,'-d',directory],{stdio:'pipe'});
}
async function provenance(){
  const failed=await checkedRun(38165680255,'5425b86e9661665dea5d06c0c616385a23d6c7a6','.github/workflows/deploy-azure-storage.yml','failure');
  const deploy=failed.find(job=>job.name==='deploy');
  if(deploy?.id!==114547831737||!deploy.steps.some(step=>step.name==='Deploy the exact qualified changed Worker with rollback checkpoint'&&step.conclusion==='success')||
    !deploy.steps.some(step=>step.name==='Record the actual qualified active Worker and configuration'&&step.conclusion==='failure'))fail('worker_deployment_provenance_mismatch');
  const front=await checkedRun(38139432843,FRONT_HEAD,'.github/workflows/deploy-azure-storage.yml','success');
  if(!front.some(job=>job.name==='deploy'&&job.conclusion==='success'&&job.steps.some(step=>step.name==='verified-production-receipt-'+PRIOR_RECEIPT&&step.conclusion==='success')))fail('frontend_receipt_provenance_mismatch');
  const diagnostic=await checkedRun(38166581212,'6477ad58d4eb4a08da141ecf5c6d85e29c04db85','.github/workflows/deploy-music-worker.yml','success','workflow_dispatch');
  if(!diagnostic.some(job=>job.name==='verify-lucy-discovery'&&job.conclusion==='success')||!diagnostic.some(job=>job.name==='deploy'&&job.conclusion==='skipped'))fail('diagnostic_provenance_mismatch');
  await artifact(11712500345,'podcast-worker-38165680255','fc35e7b6dc914ac34543ef5e3f511a3f3829ac2635a28015f4e9299867e354f9',38165680255,DIR+'/worker');
  await artifact(11702490316,'jarvis-'+FRONT_HEAD+'-38139432843-1','fb6b6b23056455c49ad1a5709197b1e0e612f5545336869252b75a31c09b00f2',38139432843,DIR+'/frontend');
  console.log('Pinned Worker checkpoint, successful frontend receipt and read-only diagnostic provenance verified.');
}
export function checkedFrontendSources(prior,current){
  if(prior.identity?.repository!==REPO||prior.identity.orchestration!==FRONT_HEAD||prior.identity.source!==FRONT_SOURCE||
    prior.identity.runId!=='38139432843'||prior.identity.attempt!=='1'||!Array.isArray(prior.files)||prior.files.length!==current.files?.length)fail('frontend_source_mismatch');
  for(let i=0;i<prior.files.length;i++){
    const a=prior.files[i],b=current.files[i];
    if(a.path!==b.path||(a.path!=='release.json'&&!same(a,b)))fail('frontend_sources_differ');
  }
}
export function checkedLiveFrontend(prior,files,receipt){
  if(receipt.source!==FRONT_SOURCE||receipt.orchestration!==FRONT_HEAD||files.length!==prior.files.length)fail('frontend_receipt_mismatch');
  for(let i=0;i<files.length;i++)if(files[i].path!==prior.files[i].path||(!CONFIGURATION_FILES.includes(files[i].path)&&!same(files[i],prior.files[i])))fail('live_frontend_changed');
  const configured={identity:{...prior.identity,baseManifestDigest:receiptDigest(prior)},files};
  if(receiptDigest(configured)!==receipt.frontendArtifactDigest||hash(JSON.stringify(files.filter(file=>CONFIGURATION_FILES.includes(file.path))))!==receipt.publicConfigurationDigest)fail('configured_frontend_digest_mismatch');
  return receipt.frontendArtifactDigest;
}
async function frontend(receipt){
  const prior=await local(DIR+'/frontend/qualified-artifact.json'),current=await local('qualified-artifact.json');
  checkedManifest(prior,prior.identity,await fileManifest(resolve(DIR+'/frontend/dist')));
  checkedFrontendSources(prior,current);
  const oldRelease=await local(DIR+'/frontend/dist/release.json'),newRelease=await local('dist/release.json');
  if(oldRelease.commit!==FRONT_SOURCE||newRelease.commit!=='c28c1b2f70aabb5217b08bf31ffe4c93d0353765'||
    !same({...oldRelease,commit:newRelease.commit},newRelease))fail('frontend_release_metadata_changed');
  const files=new Array(prior.files.length);let cursor=0;
  await Promise.all(Array.from({length:4},async()=>{while(cursor<files.length){
    const index=cursor++,file=prior.files[index],data=await bytes(ORIGIN+'/'+file.path);
    files[index]={path:file.path,sha256:hash(data),bytes:data.length};
  }}));
  checkedLiveFrontend(prior,files,receipt);
  const index=files.find(file=>file.path==='index.html');if(hash(await bytes(ORIGIN+'/'))!==index.sha256)fail('live_root_changed');
  console.log(`Preserved frontend source ${FRONT_SOURCE}: all ${files.length} live files match its sealed configured artifact.`);
}
export function checkedWorkerCheckpoint(candidate,checkpoint,live,settings,baselineBindings){
  checkedCheckpoint(checkpoint);
  if(live.version!==VERSION||settingsDigest(settings)!==live.settingsDigest||candidate.source!==checkpoint.candidate.source||
    candidate.backendReusable!==true||checkpoint.candidate.backendReusable!==true||candidate.backendDigest!==checkpoint.candidate.backendDigest||
    candidate.storageOrigin!==checkpoint.candidate.storageOrigin||candidate.apiOrigin!==checkpoint.candidate.apiOrigin)fail('worker_identity_mismatch');
  const comparison=compareBindings(settings,{baselineDigest:checkpoint.live.settingsDigest,expectedDigest:checkpoint.settingsTransition.expectedSettingsDigest,baselineBindings});
  if(!comparison.verified||comparison.otherSemanticDifferences.length)fail('unapproved_settings_difference');
  return canonicalSettingsDigest(settings);
}
async function worker(candidate){
  const credentials={account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN};
  const live=await liveIdentity(credentials),settings=await readWorkerSettings(credentials);
  const checkpoint=await local(DIR+'/worker/worker-identity-before.json'),bindings=await local(DIR+'/worker/worker-bindings-before.json');
  const canonicalDigest=checkedWorkerCheckpoint(candidate,checkpoint,live,settings,bindings);
  const response=await fetch(candidate.apiOrigin+'/relay/agents/messages',{method:'GET',redirect:'error',signal:AbortSignal.timeout(30000)});
  if(response.status!==503||(await response.json()).error!=='Lucy–Muse channel is not activated')fail('channel_not_disabled');
  return {live,canonicalDigest};
}
async function execute(command){
  if(command==='provenance')return provenance();
  if(!['record','verify','verify-published'].includes(command))fail('invalid_command');
  const release=await local('jarvis-release.json');if(release.workerDeploymentPolicy?.mode!==LUCY_RECEIPT_MODE)fail('wrong_release_mode');
  const candidate=relayCandidateIdentity();checkedRelayFullReleasePolicy(process.cwd(),candidate);
  const existing=await json(ORIGIN+'/release-qualified.json');
  if(command==='verify-published'){
    const expected=await local('release-qualified.json');
    if(receiptDigest(existing)!==receiptDigest(expected)||receiptDigest(expected)!==process.env.EXPECTED_RECEIPT_DIGEST)fail('published_receipt_mismatch');
    const {live}=await worker(candidate);if(live.version!==expected.version||live.settingsDigest!==expected.settingsDigest)fail('live_receipt_identity_changed');
    console.log('Published receipt matches the preserved frontend and existing Worker; channel data remains disabled.');return;
  }
  if(receiptDigest(existing)!==PRIOR_RECEIPT)fail('previous_receipt_changed');
  await frontend(existing);
  const {live,canonicalDigest}=await worker(candidate);
  if(!/^[1-9][0-9]{0,14}$/.test(process.env.GITHUB_RUN_ID||'')||!/^[1-9][0-9]{0,5}$/.test(process.env.GITHUB_RUN_ATTEMPT||''))fail('run_identity_invalid');
  const receipt={...candidate,repository:REPO,...live,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,
    frontendSource:existing.source,frontendOrchestration:existing.orchestration,frontendArtifactDigest:existing.frontendArtifactDigest,
    publicConfigurationDigest:existing.publicConfigurationDigest,reconciliation:{kind:'lucy-oauth-discovery',workerDeploymentRun:'38165680255',workerDeploymentAttempt:'1',
      checkpointArtifact:11712500345,previousReceiptDigest:PRIOR_RECEIPT,frontendRun:'38139432843',canonicalSettingsDigest:canonicalDigest}};
  const digest=receiptDigest(receipt);
  if(command==='record'){
    await writeFile(DIR+'/previous-receipt.json',JSON.stringify(existing,null,2)+'\n');
    await writeFile('release-qualified.json',JSON.stringify(receipt,null,2)+'\n');
    if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'digest='+digest+'\n');
    console.log(JSON.stringify({reconciliationVerified:true,workerVersion:live.version,source:candidate.source,frontendSource:existing.source,
      canonicalSettingsDigest:canonicalDigest,otherBindingsUnchanged:true,workerRedeployed:false,frontendOverwritten:false,receiptDigest:digest}));
  }else if(receiptDigest(await local('release-qualified.json'))!==digest||process.env.EXPECTED_RECEIPT_DIGEST!==digest)fail('receipt_changed');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  execute(process.argv.length===3?process.argv[2]:'invalid').catch(error=>{console.error('Lucy receipt reconciliation failed ('+(error.safeCode||'read_or_validation_failed')+'); no settings change or frontend overwrite is authorized.');process.exitCode=1;});
}
