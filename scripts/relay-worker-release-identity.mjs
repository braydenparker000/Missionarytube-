import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,appendFileSync,lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {candidateIdentity,findWorkerReuse,liveIdentity,newlyDeployedVersion,receiptDigest} from './worker-release-identity.mjs';

// This is the full-release entrypoint. The preceding client-only entrypoint and
// its finite historical transition stay unchanged and cannot deploy a Worker.
export const RELAY_SOURCE='7264c473cb45be370647d95f37aa6db99759af1a';
export const RELAY_EXTRA_RECIPES=Object.freeze(['scripts/relay-worker-release-identity.mjs','scripts/stage-relay-core-dependencies.mjs']);
const REPO='braydenparker000/Missionarytube-',ORIGIN='https://missionarytube.z13.web.core.windows.net';
const API='https://jarvis-hub-api.braydenparker999.workers.dev';
const SHA=/^[a-f0-9]{40}$/,DIGEST=/^[a-f0-9]{64}$/;
const REASONS=new Set(['receipt_missing','receipt_unavailable','receipt_invalid','origin_mismatch','backend_not_reusable',
  'backend_digest_mismatch','identity_mismatch','settings_mismatch','qualification_unavailable','qualification_mismatch',
  'qualification_incomplete','recipe_mismatch','provider_check_failed','unexpected_error']);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const blob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const policies=new WeakMap();
class ReleaseDiagnostic extends Error{constructor(reason){super('Relay release refused');this.reason=reason;}}
const refusal=reason=>new ReleaseDiagnostic(reason);
const diagnostic=error=>error instanceof ReleaseDiagnostic&&REASONS.has(error.reason)?error.reason:'unexpected_error';
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:'pipe',timeout:10000,maxBuffer:131072}).trim();

export function relayCandidateIdentity(root=process.cwd()){
  root=resolve(root);const candidate=candidateIdentity(root);
  return {...candidate,recipe:[...candidate.recipe,...RELAY_EXTRA_RECIPES.map(path=>({path,sha:blob(readFileSync(resolve(root,path)))}))]};
}
function checkedRelease(root){
  const head=git(root,'rev-parse','HEAD');
  const file=resolve(root,'jarvis-release.json'),info=lstatSync(file),bytes=readFileSync(file),release=JSON.parse(bytes);
  const keys=['apiOrigin','commit','deployPodcastWorker','preserveDriveCatalog','r2ManifestURL','repository','storageOrigin','workerDeploymentPolicy'];
  if(!info.isFile()||info.isSymbolicLink()||!equal(Object.keys(release).sort(),keys)||!SHA.test(RELAY_SOURCE)||
    release.repository!=='braydenparker999/jarvis'||release.commit!==RELAY_SOURCE||release.storageOrigin!==ORIGIN||release.apiOrigin!==API||
    release.r2ManifestURL!==API+'/music/library.json'||release.preserveDriveCatalog!==true||release.deployPodcastWorker!==true)
    throw refusal('recipe_mismatch');
  const policy=release.workerDeploymentPolicy;
  if(!policy||!equal(Object.keys(policy).sort(),['mode','recipe','schema'])||policy.schema!==1||policy.mode!=='full-release'||
    !Array.isArray(policy.recipe)||policy.recipe.length!==14)throw refusal('recipe_mismatch');
  const paths=['jarvis-release.json',...policy.recipe.map(item=>item.path)];
  if(new Set(paths).size!==paths.length)throw refusal('recipe_mismatch');
  const tree=git(root,'ls-tree','-rz',head,'--',...paths);
  const committed=new Map(tree.split('\0').filter(Boolean).map(row=>{
    const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
    if(!match)throw refusal('recipe_mismatch');return [match[3],{mode:match[1],sha:match[2]}];
  }));
  for(const path of paths){
    if(typeof path!=='string'||path.startsWith('/')||path.split('/').some(part=>['','..','.'].includes(part)))throw refusal('recipe_mismatch');
    const file=resolve(root,path),info=lstatSync(file),tracked=committed.get(path);
    if(!info.isFile()||info.isSymbolicLink()||!tracked||tracked.mode!==((info.mode&0o111)?'100755':'100644')||
      tracked.sha!==blob(readFileSync(file)))throw refusal('recipe_mismatch');
  }
  return {head,release};
}
export function checkedRelayFullReleasePolicy(root=process.cwd(),candidate=relayCandidateIdentity(root)){
  root=resolve(root);const {head,release}=checkedRelease(root);
  const current=relayCandidateIdentity(root);
  if(!equal(candidate,current)||candidate.schema!==1||candidate.source!==RELAY_SOURCE||candidate.orchestration!==head||
    git(resolve(root,'.jarvis-source'),'rev-parse','HEAD')!==RELAY_SOURCE||!DIGEST.test(candidate.backendDigest)||
    !equal(candidate.recipe,release.workerDeploymentPolicy.recipe))throw refusal('recipe_mismatch');
  const policy=Object.freeze({});policies.set(policy,JSON.stringify(candidate));return policy;
}
export async function planRelayFullRelease(candidate,live,{policy,fetcher=globalThis.fetch}={}){
  if(policies.get(policy)!==JSON.stringify(candidate))throw refusal('recipe_mismatch');
  // Only the unchanged exact-production proof can skip publication. A recipe,
  // code or receipt refusal proceeds through the original qualified deployment
  // lane; provider identity failure remains fatal before this decision.
  return findWorkerReuse(candidate,live,{fetcher});
}
function checkedCheckpoint(before,candidate){
  if(!before||!equal(Object.keys(before).sort(),['candidate','live','proof'])||!equal(before.candidate,candidate)||
    !before.live||typeof before.proof?.reuse!=='boolean'||(before.proof.reuse!==true&&!REASONS.has(before.proof.reason)))
    throw refusal('recipe_mismatch');
  return before;
}
function checkedCurrent(expected,candidate,live){
  if(!expected||!equal(Object.keys(expected).sort(),['candidate','live'])||!equal(expected.candidate,candidate)||!equal(expected.live,live))
    throw refusal('identity_mismatch');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    if(process.argv.length!==3||!['plan','record','verify','receipt','verify-receipt'].includes(process.argv[2]))throw refusal('recipe_mismatch');
    checkedRelease(process.cwd());
    const command=process.argv[2],candidate=relayCandidateIdentity(),policy=checkedRelayFullReleasePolicy(process.cwd(),candidate);
    let live;try{live=await liveIdentity({account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN});}
    catch{throw refusal('provider_check_failed');}
    if(command==='plan'){
      const proof=await planRelayFullRelease(candidate,live,{policy});
      writeFileSync('worker-identity-before.json',JSON.stringify({candidate,live,proof},null,2)+'\n');
      if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'deploy='+!proof.reuse+'\n');
      console.log(proof.reuse?'Actual active Worker and configuration match a verified successful production release':
        `No exact live Worker reuse proof (${proof.reason}); current qualified backend deployment required`);
    }else if(command==='record'){
      const before=checkedCheckpoint(JSON.parse(readFileSync('worker-identity-before.json','utf8')),candidate);
      if(before.live.settingsDigest!==live.settingsDigest)throw refusal('settings_mismatch');
      if(before.proof.reuse){if(!equal(before.live,live))throw refusal('identity_mismatch');}
      else newlyDeployedVersion(JSON.parse(readFileSync('.jarvis-source/worker-versions-before.json','utf8')),
        JSON.parse(readFileSync('.jarvis-source/worker-versions-after.json','utf8')),live);
      writeFileSync('worker-identity-current.json',JSON.stringify({candidate,live},null,2)+'\n');
    }else if(command==='verify'){
      checkedCurrent(JSON.parse(readFileSync('worker-identity-current.json','utf8')),candidate,live);
    }else if(command==='receipt'){
      checkedCurrent(JSON.parse(readFileSync('worker-identity-current.json','utf8')),candidate,live);
      if(!/^[1-9][0-9]{0,14}$/.test(process.env.GITHUB_RUN_ID||'')||!/^[1-9][0-9]{0,5}$/.test(process.env.GITHUB_RUN_ATTEMPT||''))throw refusal('qualification_mismatch');
      const receipt={...candidate,repository:REPO,...live,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT};
      const configured=JSON.parse(readFileSync('configured-artifact.json','utf8'));
      receipt.frontendArtifactDigest=receiptDigest(configured);
      receipt.publicConfigurationDigest=hash(JSON.stringify(configured.files.filter(file=>['assets/quick-ai-config.json','assets/drive-config.json'].includes(file.path))));
      writeFileSync('release-qualified.json',JSON.stringify(receipt,null,2)+'\n');
      if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'digest='+receiptDigest(receipt)+'\n');
    }else{
      const receipt=JSON.parse(readFileSync('release-qualified.json','utf8'));
      const expected=JSON.parse(readFileSync('worker-identity-current.json','utf8'));
      checkedCurrent(expected,candidate,live);
      if(receiptDigest(receipt)!==process.env.EXPECTED_RECEIPT_DIGEST||!equal(receipt.recipe,candidate.recipe)||
        receipt.source!==candidate.source||receipt.orchestration!==candidate.orchestration||receipt.repository!==REPO||
        receipt.backendDigest!==candidate.backendDigest||receipt.version!==live.version||receipt.settingsDigest!==live.settingsDigest)
        throw refusal('identity_mismatch');
    }
  }catch(error){console.error(`Worker identity qualification failed (${diagnostic(error)}); no frontend promotion is authorized`);process.exitCode=1;}
}
