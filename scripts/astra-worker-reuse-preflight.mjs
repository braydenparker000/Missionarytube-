import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// This observation never authorizes promotion. The existing action-time
// plan/record/verify and production receipt checks remain mandatory.
export const TARGET=Object.freeze({
  repository:'braydenparker000/Missionarytube-',
  branch:'release/astra-live-candidate-20261009',actorId:'183016859',actor:'braydenparker999',
  orchestration:'4532be6b6842320ed0cc64be973425d9505c7b03',
  source:'f999581aa979712b4b63a6783b7c56842fedb6a1',
  backendDigest:'2b9daec99e498c7c43f658ca1898f09dc6fed83b92f87a3b82e77ee32cb128b5',
  pinDigest:'54fe5b2fbf39de05214955523feddfb2872a72b39e02752aa3f7eab1d46f690e',
  configDigest:'17b8fdd15b47eb35cf37a366cf42e9eefdf25e3d457e0e5a77b86f6fac9a7595',
});
export const RECIPES=Object.freeze([
  ['.github/workflows/deploy-azure-storage.yml','33e98b0b3e82f6ff43b228d111bfcb5cd1d2f24c'],
  ['.github/workflows/qualify-jarvis.yml','f4bc1df3cd797c9517342d58d404f5ef1e2ec45b'],
  ['scripts/plan-jarvis-qualification.mjs','791835fc23006bcfed4e39a3fa774193f565dcdc'],
  ['scripts/install-jarvis-browser.mjs','6c409f044097fc6ad2460d48efa4d2a4c95685cc'],
  ['scripts/worker-release-identity.mjs','4ac2cefceb2a1409064a1e99f23aa4bf47718f30'],
  ['scripts/prepare-music-worker.mjs','825fee647eed7d583e77e02a6dbdf3fbc41d5887'],
  ['scripts/prepare-worker-tools.mjs','aab50340494d89066dcab9dda1a51a6b643e848b'],
  ['scripts/check-music-worker-bindings.mjs','3ef4f486a24037b8f8821e6e593a98b7cb902a78'],
  ['scripts/qualified-artifact.mjs','b1579ef43ecadb1a06577e0f13949450169090e7'],
  ['scripts/backup-jarvis-storage.mjs','6ab19a7dcb4966d3946332a950a46a103b240cee'],
  ['scripts/overlap-jarvis-prewrite.mjs','f9c52feacb60bd5f0894f90f741bd08075a2fe84'],
].map(Object.freeze));
const REASONS=new Set(['receipt_missing','receipt_unavailable','receipt_invalid','origin_mismatch','backend_not_reusable',
  'backend_digest_mismatch','identity_mismatch','settings_mismatch','qualification_unavailable','qualification_mismatch',
  'qualification_incomplete','recipe_mismatch','provider_check_failed','unexpected_error']);
const sha=value=>createHash('sha256').update(value).digest('hex');
const PREFLIGHT_FILES=Object.freeze(['.github/workflows/astra-worker-reuse-preflight.yml',
  'scripts/astra-worker-reuse-preflight.mjs','scripts/astra-worker-reuse-preflight.test.mjs']);
const git=(root,...args)=>execFileSync('git',['--no-optional-locks','-C',root,...args],
  {encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000,maxBuffer:1024*1024}).trim();
const result=(classification,reuse=false)=>({source:TARGET.source,orchestration:TARGET.orchestration,
  classification,reuse,observation:'temporary; action-time revalidation required'});
const reject=()=>{throw Error('Preflight rejected');};
const file=path=>{const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink())reject();return readFileSync(path);};

export function authorizedContext(env,head){
  return env.GITHUB_REPOSITORY===TARGET.repository&&env.GITHUB_EVENT_NAME==='push'&&
    env.GITHUB_REF==='refs/heads/'+TARGET.branch&&env.GITHUB_ACTOR_ID===TARGET.actorId&&
    env.GITHUB_ACTOR===TARGET.actor&&env.GITHUB_TRIGGERING_ACTOR===TARGET.actor&&
    /^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&env.GITHUB_SHA===head;
}
function checkedCheckout(root,head){
  if(realpathSync(root)!==root||!lstatSync(root).isDirectory()||git(root,'rev-parse','--show-toplevel')!==root||
    git(root,'rev-parse','HEAD')!==head)reject();
  git(root,'diff','HEAD','--exit-code');
}
export function checkedCandidate(candidate){
  if(candidate?.schema!==1||candidate.source!==TARGET.source||candidate.orchestration!==TARGET.orchestration||
    candidate.backendReusable!==true||candidate.backendDigest!==TARGET.backendDigest||
    candidate.storageOrigin!=='https://missionarytube.z13.web.core.windows.net'||
    candidate.apiOrigin!=='https://jarvis-hub-api.braydenparker999.workers.dev'||
    JSON.stringify(candidate.recipe)!==JSON.stringify(RECIPES.map(([path,sha])=>({path,sha}))))reject();
  return candidate;
}
export function checkedPin(bytes){
  if(sha(bytes)!==TARGET.pinDigest)reject();
  const release=JSON.parse(bytes);
  if(release.repository!=='braydenparker999/jarvis'||release.commit!==TARGET.source||release.deployPodcastWorker!==true)reject();
}
export function checkedConfiguration(bytes){if(sha(bytes)!==TARGET.configDigest)reject();}
export function checkedReleaseHead(root=process.cwd(),head=git(root,'rev-parse','HEAD')){
  root=resolve(root);checkedCheckout(root,head);
  checkedPin(file(resolve(root,'jarvis-release.json')));
  for(const [path,expected] of RECIPES){const bytes=file(resolve(root,path));
    if(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')!==expected)reject();}
  git(root,'merge-base','--is-ancestor',TARGET.orchestration,head);
  const delta=git(root,'diff','--name-status','--no-renames',TARGET.orchestration,head,'--');
  if(delta!==PREFLIGHT_FILES.map(path=>'A\t'+path).sort().join('\n'))reject();
  PREFLIGHT_FILES.forEach(path=>file(resolve(root,path)));
}
export async function trustedCandidate(root=resolve('.astra-trusted-release')){
  root=resolve(root);
  checkedCheckout(root,TARGET.orchestration);
  checkedPin(file(resolve(root,'jarvis-release.json')));
  for(const [path,expected] of RECIPES){const bytes=file(resolve(root,path));
    if(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')!==expected)reject();}
  const source=resolve(root,'.jarvis-source');
  checkedCheckout(source,TARGET.source);
  checkedConfiguration(file(resolve(source,'backend/wrangler.music.generated.json')));
  const identity=await import(pathToFileURL(resolve(root,'scripts/worker-release-identity.mjs')).href);
  return {identity,candidate:checkedCandidate(identity.candidateIdentity(root))};
}

// There is no caller URL/ref input. Even the unchanged trusted readers receive
// an ordered allowlist: two provider GETs, then at most four public proof GETs.
export function sealedReaders({account,token,signal,fetcher=globalThis.fetch}){
  if(!/^[a-f0-9]{32}$/.test(account||'')||typeof token!=='string'||!token)reject();
  const provider=[`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/settings`,
    `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/deployments?per_page=1`];
  let providerIndex=0,proofIndex=0,runId,totalBytes=0;
  const read=async(url,init,authenticated)=>{
    if(signal.aborted||typeof url!=='string'||init?.method!=='GET'||init.redirect!=='error'||
      init.body!==undefined||!(init.signal instanceof AbortSignal))reject();
    const headers=new Headers(init.headers);
    if(authenticated){
      if(url!==provider[providerIndex]||[...headers].length!==1||headers.get('authorization')!=='Bearer '+token)reject();
      providerIndex++;
    }else{
      if(providerIndex!==2||proofIndex>=4||[...headers].length!==1||headers.get('accept')!=='application/vnd.github+json')reject();
      if(proofIndex===0&&url!=='https://missionarytube.z13.web.core.windows.net/release-qualified.json')reject();
      if(proofIndex===1){const match=/^https:\/\/api\.github\.com\/repos\/braydenparker000\/Missionarytube-\/actions\/runs\/([1-9][0-9]{0,14})$/.exec(url);if(!match)reject();runId=match[1];}
      if(proofIndex===2&&!/^https:\/\/api\.github\.com\/repos\/braydenparker000\/Missionarytube-\/git\/trees\/[a-f0-9]{40}\?recursive=1$/.test(url))reject();
      if(proofIndex===3&&!new RegExp('^https://api\\.github\\.com/repos/braydenparker000/Missionarytube-/actions/runs/'+runId+'/attempts/[1-9][0-9]{0,5}/jobs\\?per_page=100$').test(url))reject();
      proofIndex++;
    }
    const combined=AbortSignal.any([signal,init.signal]);
    const response=await fetcher(url,{method:'GET',redirect:'error',signal:combined,
      headers:authenticated?{Authorization:'Bearer '+token}:{Accept:'application/vnd.github+json'}});
    if(!response.ok){await response.body?.cancel();return {ok:false,status:response.status};}
    return {ok:true,status:response.status,json:async()=>{
      const reader=response.body.getReader(),chunks=[];let bytes=0;
      try{for(;;){if(combined.aborted)reject();const chunk=await reader.read();if(chunk.done)break;
        bytes+=chunk.value.byteLength;totalBytes+=chunk.value.byteLength;
        if(bytes>2*1024*1024||totalBytes>8*1024*1024)reject();chunks.push(chunk.value);}
        if(combined.aborted)reject();return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      }catch{await reader.cancel();reject();}finally{reader.releaseLock();}
    }};
  };
  return {provider:(url,init)=>read(url,init,true),proof:(url,init)=>read(url,init,false)};
}
export async function observeReuse({identity,candidate,account,token,fetcher=globalThis.fetch,timeoutMs=90000}){
  try{checkedCandidate(candidate);}catch{return result('candidate_mismatch');}
  const controller=new AbortController();let phase='provider',timer;
  const expired=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();
    resolve(result(phase==='provider'?'provider_check_failed':'qualification_unavailable'));},Math.min(90000,Math.max(1,timeoutMs)));});
  try{
    return await Promise.race([expired,(async()=>{
      let readers,live;
      try{readers=sealedReaders({account,token,signal:controller.signal,fetcher});
        live=await identity.liveIdentity({account,token,fetcher:readers.provider});}
      catch{return result('provider_check_failed');}
      phase='proof';
      try{const proof=await identity.findWorkerReuse(candidate,live,{fetcher:readers.proof});
        if(controller.signal.aborted)return result('qualification_unavailable');
        return proof?.reuse===true?result('reuse_verified',true):result(REASONS.has(proof?.reason)?proof.reason:'unexpected_error');}
      catch{return result('unexpected_error');}
    })()]);
  }finally{clearTimeout(timer);controller.abort();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const mode=process.argv[2];
  // Keep existing credentials out of the offline bundler/import environment.
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;delete process.env.CLOUDFLARE_API_TOKEN;
  let output=result('invalid_invocation'),okay=false;
  try{
    if(process.argv.length!==3||!['verify','read'].includes(mode))reject();
    const head=git(process.cwd(),'rev-parse','HEAD');
    if(mode==='read'&&!authorizedContext(process.env,head))reject();
    output=result('candidate_mismatch');
    checkedReleaseHead(process.cwd(),head);
    const trusted=await trustedCandidate();
    if(mode==='verify'){output=result('candidate_verified');okay=true;}
    else{output=await observeReuse({...trusted,account,token});okay=output.reuse;}
  }catch{}
  console.log(JSON.stringify(output));
  if(!okay)process.exitCode=1;
}
