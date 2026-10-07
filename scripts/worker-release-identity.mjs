import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkedBindings,readWorkerSettings} from './check-music-worker-bindings.mjs';

const REPO='braydenparker000/Missionarytube-',WORKFLOW='.github/workflows/deploy-azure-storage.yml';
const RECIPES=[WORKFLOW,'.github/workflows/qualify-jarvis.yml','scripts/plan-jarvis-qualification.mjs','scripts/install-jarvis-browser.mjs','scripts/worker-release-identity.mjs','scripts/prepare-music-worker.mjs','scripts/prepare-worker-tools.mjs','scripts/check-music-worker-bindings.mjs','scripts/qualified-artifact.mjs'];
const SHA=/^[a-f0-9]{40}$/,DIGEST=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const blob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
export function candidateIdentity(root=process.cwd()){
  const source=resolve(root,'.jarvis-source'),release=JSON.parse(readFileSync(resolve(root,'jarvis-release.json'),'utf8'));
  const paths=execFileSync('git',['-C',source,'ls-files','-z','backend','package-lock.json'],{encoding:'utf8'}).split('\0').filter(Boolean).sort();
  const inputs=paths.map(path=>[path,hash(readFileSync(resolve(source,path)))]);
  const recipe=RECIPES.map(path=>({path,sha:blob(readFileSync(resolve(root,path)))}));
  const backendDigest=hash({schema:1,inputs,preparer:recipe.find(x=>x.path==='scripts/prepare-music-worker.mjs').sha,
    generatedConfig:hash(readFileSync(resolve(source,'backend/wrangler.music.generated.json'))),wrangler:'4.136.3'});
  return {schema:1,source:release.commit,orchestration:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),backendDigest,recipe,
    storageOrigin:release.storageOrigin,apiOrigin:release.apiOrigin};
}
export function activeVersion(data){
  const deployment=data?.success===true&&data.result?.deployments?.[0],versions=deployment?.versions;
  if(!UUID.test(deployment?.id||'')||!Array.isArray(versions)||versions.length!==1||versions[0].percentage!==100||!UUID.test(versions[0].version_id||''))
    throw Error('An exact single active Worker version is required');
  return versions[0].version_id;
}
export function settingsDigest(settings){
  checkedBindings(settings);
  // Plaintext values are hashed in memory only. No provider values, tokens or
  // secret material are returned, logged or persisted in any receipt.
  return hash(settings.bindings.map(b=>({...b})).sort((a,b)=>a.name.localeCompare(b.name)));
}
export async function liveIdentity({account,token,fetcher=globalThis.fetch}){
  const settings=await readWorkerSettings({account,token,fetcher});
  const response=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/deployments?per_page=1`,
    {method:'GET',redirect:'error',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Active Worker identity could not be verified');
  return {version:activeVersion(await response.json()),settingsDigest:settingsDigest(settings)};
}
export const receiptDigest=receipt=>hash(JSON.stringify(receipt));
export function checkedReuse(receipt,candidate,live,run,tree,jobs){
  if(!receipt||receipt.schema!==1||receipt.repository!==REPO||receipt.backendDigest!==candidate.backendDigest||receipt.version!==live.version||
    receipt.settingsDigest!==live.settingsDigest||receipt.storageOrigin!==candidate.storageOrigin||receipt.apiOrigin!==candidate.apiOrigin||
    !SHA.test(receipt.source||'')||!SHA.test(receipt.orchestration||'')||!DIGEST.test(receipt.backendDigest||'')||!UUID.test(receipt.version||''))throw Error('Worker receipt does not match actual code, configuration and live provider identity');
  if(!run||run.repository?.full_name!==REPO||run.head_repository?.full_name!==REPO||run.head_repository?.fork===true||
    !['push','workflow_dispatch'].includes(run.event)||run.head_branch!=='main'||run.path!==WORKFLOW||run.head_sha!==receipt.orchestration||
    String(run.id)!==receipt.runId||String(run.run_attempt)!==receipt.attempt||run.status!=='completed'||run.conclusion!=='success')throw Error('Worker receipt is not from a successful exact production release');
  if(!tree||tree.truncated!==false||!Array.isArray(tree.tree)||JSON.stringify(receipt.recipe)!==JSON.stringify(candidate.recipe))throw Error('Worker release recipe mismatch');
  for(const entry of candidate.recipe){const files=tree.tree.filter(e=>e.path===entry.path&&e.type==='blob');if(files.length!==1||files[0].sha!==entry.sha)throw Error('Untrusted immutable production recipe');}
  if(!jobs||!Array.isArray(jobs.jobs)||jobs.total_count!==jobs.jobs.length)throw Error('Incomplete immutable production job metadata');
  const deploy=jobs.jobs.filter(j=>j.name==='deploy');
  if(deploy.length!==1||deploy[0].run_id!==run.id||deploy[0].run_attempt!==run.run_attempt||deploy[0].head_sha!==receipt.orchestration||deploy[0].status!=='completed'||deploy[0].conclusion!=='success')throw Error('Receipt job is not the exact successful production attempt');
  const stamps=deploy[0].steps.filter(s=>s.name==='verified-production-receipt-'+receiptDigest(receipt));
  if(stamps.length!==1||stamps[0].status!=='completed'||stamps[0].conclusion!=='success')throw Error('Mutable receipt is not bound to this production run immutable success metadata');
  return true;
}
export function newlyDeployedVersion(before,after,live){
  if(!Array.isArray(before)||!Array.isArray(after)||before.some(v=>!UUID.test(v.id||''))||after.some(v=>!UUID.test(v.id||'')))throw Error('Invalid Worker version checkpoints');
  const old=new Set(before.map(v=>v.id)),created=after.filter(v=>!old.has(v.id));
  if(created.length!==1||created[0].id!==live.version)throw Error('Actual active Worker is not the uniquely uploaded qualified version');
  return true;
}
async function publicJson(url,fetcher){
  const r=await fetcher(url,{method:'GET',redirect:'error',headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('Previous successful release proof unavailable');
  return r.json();
}
export async function findWorkerReuse(candidate,live,{fetcher=globalThis.fetch}={}){
  try{
    if(candidate.storageOrigin!=='https://missionarytube.z13.web.core.windows.net')throw Error('Unexpected receipt origin');
    const receipt=await publicJson(candidate.storageOrigin+'/release-qualified.json',fetcher);
    if(!/^[1-9][0-9]{0,14}$/.test(receipt.runId||'')||!/^[1-9][0-9]{0,5}$/.test(receipt.attempt||'')||!SHA.test(receipt.orchestration||''))throw Error('Invalid production receipt');
    const run=await publicJson(`https://api.github.com/repos/${REPO}/actions/runs/${receipt.runId}`,fetcher);
    const tree=await publicJson(`https://api.github.com/repos/${REPO}/git/trees/${receipt.orchestration}?recursive=1`,fetcher);
    const jobs=await publicJson(`https://api.github.com/repos/${REPO}/actions/runs/${receipt.runId}/attempts/${receipt.attempt}/jobs?per_page=100`,fetcher);
    checkedReuse(receipt,candidate,live,run,tree,jobs);
    return {reuse:true,runId:receipt.runId,attempt:receipt.attempt,version:live.version};
  }catch{return {reuse:false};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const command=process.argv[2],candidate=candidateIdentity(),live=await liveIdentity({account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN});
    if(command==='plan'){
      const proof=await findWorkerReuse(candidate,live);
      writeFileSync('worker-identity-before.json',JSON.stringify({candidate,live,proof},null,2)+'\n');
      if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'deploy='+!proof.reuse+'\n');
      console.log(proof.reuse?'Actual active Worker and configuration match a verified successful production release':'No exact live Worker reuse proof; current qualified backend deployment required');
    }else if(command==='record'){
      const before=JSON.parse(readFileSync('worker-identity-before.json','utf8'));
      if(before.proof.reuse){
        if(JSON.stringify(before.live)!==JSON.stringify(live)||before.candidate.backendDigest!==candidate.backendDigest)throw Error('Previously qualified Worker changed before recording');
      }else newlyDeployedVersion(JSON.parse(readFileSync('.jarvis-source/worker-versions-before.json','utf8')),JSON.parse(readFileSync('.jarvis-source/worker-versions-after.json','utf8')),live);
      writeFileSync('worker-identity-current.json',JSON.stringify({candidate,live},null,2)+'\n');
    }else if(command==='verify'){
      const expected=JSON.parse(readFileSync('worker-identity-current.json','utf8'));
      if(expected.candidate.backendDigest!==candidate.backendDigest||expected.live.version!==live.version||expected.live.settingsDigest!==live.settingsDigest)throw Error('Live Worker changed during release; frontend promotion stopped');
    }else if(command==='receipt'){
      const expected=JSON.parse(readFileSync('worker-identity-current.json','utf8'));
      if(JSON.stringify(expected.live)!==JSON.stringify(live))throw Error('Live Worker changed after final frontend verification');
      const receipt={...candidate,repository:REPO,...live,runId:String(process.env.GITHUB_RUN_ID),attempt:String(process.env.GITHUB_RUN_ATTEMPT)};
      const configured=JSON.parse(readFileSync('configured-artifact.json','utf8'));
      receipt.frontendArtifactDigest=receiptDigest(configured);
      receipt.publicConfigurationDigest=hash(configured.files.filter(f=>['assets/quick-ai-config.json','assets/drive-config.json'].includes(f.path)));
      writeFileSync('release-qualified.json',JSON.stringify(receipt,null,2)+'\n');
      if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'digest='+receiptDigest(receipt)+'\n');
    }else if(command==='verify-receipt'){
      const receipt=JSON.parse(readFileSync('release-qualified.json','utf8'));
      if(receiptDigest(receipt)!==process.env.EXPECTED_RECEIPT_DIGEST||receipt.backendDigest!==candidate.backendDigest||receipt.version!==live.version||receipt.settingsDigest!==live.settingsDigest)throw Error('Production receipt changed before its immutable success stamp');
    }else throw Error('Use plan, record, verify or receipt');
  }catch{console.error('Worker identity qualification failed; no frontend promotion is authorized');process.exitCode=1;}
}
