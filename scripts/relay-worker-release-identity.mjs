import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,appendFileSync,lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {candidateIdentity,findWorkerReuse,liveIdentity,newlyDeployedVersion,receiptDigest,settingsDigest} from './worker-release-identity.mjs';
import {readWorkerSettings} from './check-music-worker-bindings.mjs';

// This is the full-release entrypoint. The preceding client-only entrypoint and
// its finite historical transition stay unchanged and cannot deploy a Worker.
export const RELAY_SOURCE='c28c1b2f70aabb5217b08bf31ffe4c93d0353765';
export const RELAY_EXTRA_RECIPES=Object.freeze(['scripts/relay-worker-release-identity.mjs','scripts/stage-relay-core-dependencies.mjs',
  'scripts/lucy-settings-diagnostic.mjs','scripts/reconcile-lucy-receipt.mjs']);
export const LUCY_RECEIPT_MODE='reconcile-lucy-discovery';
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

// Finite approved transition from the digest-bound production receipt for run
// 38139432843. No caller, workflow input or environment can select another flag,
// value, prior Worker or baseline. Provider values stay in memory only.
export const LUCY_DISCOVERY_BASELINE=Object.freeze({
  version:'3be007a0-cad1-45c8-8580-7a1105840d66',
  settingsDigest:'ff0e42eea34106d9ddf694dc50600bb2aea4101b21a4e3a18464ebc48691e415'
});
const LUCY_DISCOVERY_FLAG='RELAY_AGENT_LUCY_OAUTH_ENABLED';
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value!==null&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
// Keep the legacy binding-name identity rule; normalize only object keys.
// Arrays inside bindings retain their exact order. Legacy receipt hashes remain unchanged.
export const canonicalSettingsDigest=settings=>settingsDigest(canonical(settings));
export function checkedLucyDiscoveryBaseline(live){
  if(!equal(live,LUCY_DISCOVERY_BASELINE))throw refusal('settings_mismatch');
}
function discoveryBinding(settings){
  settingsDigest(settings); // Retain every existing binding/security check.
  const matches=settings.bindings.filter(binding=>binding.name===LUCY_DISCOVERY_FLAG);
  if(matches.length>1||matches.some(binding=>!equal(Object.keys(binding).sort(),['name','text','type'])||binding.type!=='plain_text'||!['false','true'].includes(binding.text)))
    throw refusal('settings_mismatch');
  return matches[0];
}
export function expectedLucyDiscoverySettings(settings){
  discoveryBinding(settings);
  return settingsDigest({...settings,bindings:[...settings.bindings.filter(binding=>binding.name!==LUCY_DISCOVERY_FLAG),
    {name:LUCY_DISCOVERY_FLAG,type:'plain_text',text:'true'}]});
}
export function expectedCanonicalLucyDiscoverySettings(settings){
  discoveryBinding(settings);
  return canonicalSettingsDigest({...settings,bindings:[...settings.bindings.filter(binding=>binding.name!==LUCY_DISCOVERY_FLAG),
    {name:LUCY_DISCOVERY_FLAG,type:'plain_text',text:'true'}]});
}
export function planLucyDiscoverySettings(settings,live){
  if(settingsDigest(settings)!==live.settingsDigest)throw refusal('settings_mismatch');
  const current=discoveryBinding(settings);
  if(current?.text==='true')return {kind:'unchanged',expectedSettingsDigest:live.settingsDigest};
  checkedLucyDiscoveryBaseline(live);
  return {kind:'lucy-oauth-discovery',expectedSettingsDigest:expectedLucyDiscoverySettings(settings),
    expectedCanonicalSettingsDigest:expectedCanonicalLucyDiscoverySettings(settings)};
}
export function checkedLucyDiscoveryCheckpoint(before){
  const transition=before.settingsTransition;
  if(!transition||!DIGEST.test(transition.expectedSettingsDigest))
    throw refusal('settings_mismatch');
  if(transition.kind==='unchanged'){
    if(!equal(Object.keys(transition).sort(),['expectedSettingsDigest','kind'])||transition.expectedSettingsDigest!==before.live.settingsDigest)throw refusal('settings_mismatch');
  }else if(transition.kind==='lucy-oauth-discovery'){
    checkedLucyDiscoveryBaseline(before.live);
    if(!equal(Object.keys(transition).sort(),['expectedCanonicalSettingsDigest','expectedSettingsDigest','kind'])||
      !DIGEST.test(transition.expectedCanonicalSettingsDigest)||before.proof.reuse!==false||transition.expectedSettingsDigest===before.live.settingsDigest)throw refusal('settings_mismatch');
    return transition.expectedCanonicalSettingsDigest;
  }else throw refusal('settings_mismatch');
  return transition.expectedSettingsDigest;
}

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
  if(!policy||!equal(Object.keys(policy).sort(),['mode','recipe','schema'])||policy.schema!==1||!['full-release',LUCY_RECEIPT_MODE].includes(policy.mode)||
    !Array.isArray(policy.recipe)||policy.recipe.length!==12+RELAY_EXTRA_RECIPES.length)throw refusal('recipe_mismatch');
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
  if(!before||!equal(Object.keys(before).sort(),['candidate','live','proof','settingsTransition'])||!equal(before.candidate,candidate)||
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
    if(checkedRelease(process.cwd()).release.workerDeploymentPolicy.mode!=='full-release')throw refusal('recipe_mismatch');
    const command=process.argv[2],candidate=relayCandidateIdentity(),policy=checkedRelayFullReleasePolicy(process.cwd(),candidate);
    let live;try{live=await liveIdentity({account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN});}
    catch{throw refusal('provider_check_failed');}
    if(command==='plan'){
      const proof=await planRelayFullRelease(candidate,live,{policy});
      let settings;try{settings=await readWorkerSettings({account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN});}
      catch{throw refusal('provider_check_failed');}
      const settingsTransition=planLucyDiscoverySettings(settings,live);
      const config=JSON.parse(readFileSync('.jarvis-source/backend/wrangler.music.generated.json','utf8'));
      if(config.keep_vars!==true||config.vars?.[LUCY_DISCOVERY_FLAG]!=='true'||settingsTransition.kind!=='unchanged'&&proof.reuse)
        throw refusal('settings_mismatch');
      writeFileSync('worker-identity-before.json',JSON.stringify({candidate,live,proof,settingsTransition},null,2)+'\n');
      if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'deploy='+!proof.reuse+'\n');
      console.log(proof.reuse?'Actual active Worker and configuration match a verified successful production release':
        `No exact live Worker reuse proof (${proof.reason}); current qualified backend deployment required`);
    }else if(command==='record'){
      const before=checkedCheckpoint(JSON.parse(readFileSync('worker-identity-before.json','utf8')),candidate);
      const expected=checkedLucyDiscoveryCheckpoint(before);
      if(before.settingsTransition.kind==='lucy-oauth-discovery'){
        const settings=await readWorkerSettings({account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN});
        if(settingsDigest(settings)!==live.settingsDigest||canonicalSettingsDigest(settings)!==expected)throw refusal('settings_mismatch');
      }else if(expected!==live.settingsDigest)throw refusal('settings_mismatch');
      if(before.proof.reuse){if(!equal(before.live,live))throw refusal('identity_mismatch');}
      else newlyDeployedVersion(JSON.parse(readFileSync('.jarvis-source/worker-versions-before.json','utf8')),
        JSON.parse(readFileSync('.jarvis-source/worker-versions-after.json','utf8')),live);
      writeFileSync('worker-identity-current.json',JSON.stringify({candidate,live},null,2)+'\n');
      if(before.settingsTransition.kind==='lucy-oauth-discovery')console.log(JSON.stringify({
        settingsTransition:'lucy-oauth-discovery',flag:LUCY_DISCOVERY_FLAG,value:'true',
        beforeSettingsDigest:before.live.settingsDigest,expectedCanonicalSettingsDigest:before.settingsTransition.expectedCanonicalSettingsDigest,
        actualSettingsDigest:live.settingsDigest,otherBindingsUnchanged:true}));
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
