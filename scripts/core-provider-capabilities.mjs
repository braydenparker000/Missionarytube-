import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const TARGET=Object.freeze({
  repository:'braydenparker000/Missionarytube-',
  branch:'review/core-provider-capabilities-20261009',
  actorId:'183016859',actor:'braydenparker999',
  base:'9c01243ad03b921a0b0614d5eb003944a2807a6c',
  worker:'jarvis-hub-api',binding:'HUBS',className:'Hub',
});
export const LIMITS=Object.freeze({requests:2,timeoutMs:30000,responseBytes:256*1024,totalBytes:512*1024,responseChunks:1024});
export const PUBLIC_FILES=Object.freeze([
  '.github/workflows/core-provider-capabilities.yml',
  'docs/core-provider-capabilities-20261009.md',
  'scripts/core-provider-capabilities.mjs',
  'scripts/core-provider-capabilities.test.mjs',
]);
export const FROZEN=Object.freeze([
  'jarvis-release.json',
  '.github/workflows/deploy-azure-storage.yml',
  '.github/workflows/qualify-jarvis.yml',
  'scripts/plan-jarvis-qualification.mjs',
  'scripts/install-jarvis-browser.mjs',
  'scripts/worker-release-identity.mjs',
  'scripts/prepare-music-worker.mjs',
  'scripts/prepare-worker-tools.mjs',
  'scripts/check-music-worker-bindings.mjs',
  'scripts/qualified-artifact.mjs',
  'scripts/backup-jarvis-storage.mjs',
  'scripts/overlap-jarvis-prewrite.mjs',
  '.github/workflows/astra-worker-reuse-preflight.yml',
  'scripts/astra-worker-reuse-preflight.mjs',
  'scripts/astra-worker-reuse-preflight.test.mjs',
]);
export const DATASETS=Object.freeze([
  'durableObjectsInvocationsAdaptiveGroups',
  'durableObjectsPeriodicGroups',
  'durableObjectsStorageGroups',
  'durableObjectsSubrequestsAdaptiveGroups',
]);
// Only account-scoped settings metadata. No analytics records, metrics, SQL,
// objects, mutations, caller query, namespace selector or pagination are used.
export const QUERY=`query CoreCapabilitySettings($accountTag: string) {
  viewer {
    accounts(filter: {accountTag: $accountTag}) {
      accountTag
      settings {
        durableObjectsInvocationsAdaptiveGroups { enabled availableFields }
        durableObjectsPeriodicGroups { enabled availableFields }
        durableObjectsStorageGroups { enabled availableFields }
        durableObjectsSubrequestsAdaptiveGroups { enabled availableFields }
      }
    }
  }
}`;

const classifications=new Set([
  'checkout_verified','capabilities_available','capabilities_partial','capabilities_unavailable',
  'invalid_invocation','context_refused','checkout_refused','credentials_unavailable',
  'worker_denied','worker_unavailable','hubs_binding_refused','analytics_denied',
  'analytics_unavailable','analytics_refused','analytics_scope_refused',
  'response_invalid','response_limit','timeout',
]);
class Refusal extends Error {
  constructor(classification){super('Bounded metadata observation refused');this.classification=classification;}
}
const refuse=classification=>{throw new Refusal(classification);};
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const git=(root,...args)=>execFileSync('git',['--no-optional-locks','-C',root,...args],
  {encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000,maxBuffer:1024*1024}).trim();
const file=path=>{
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)refuse('checkout_refused');
  return readFileSync(path);
};

export function authorizedContext(env,head,event){
  return env.GITHUB_REPOSITORY===TARGET.repository&&env.GITHUB_EVENT_NAME==='push'&&
    env.GITHUB_REF==='refs/heads/'+TARGET.branch&&env.GITHUB_ACTOR_ID===TARGET.actorId&&
    env.GITHUB_ACTOR===TARGET.actor&&env.GITHUB_TRIGGERING_ACTOR===TARGET.actor&&env.GITHUB_RUN_ATTEMPT==='1'&&
    /^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&env.GITHUB_SHA===head&&
    event?.repository?.full_name===TARGET.repository&&event.repository.fork===false&&
    event.sender?.id===Number(TARGET.actorId)&&event.sender.login===TARGET.actor&&
    event.ref===env.GITHUB_REF&&event.after===head&&event.before==='0'.repeat(40)&&
    event.created===true&&event.deleted===false&&event.forced===false;
}

export function checkedReleaseHead(root=process.cwd(),head=git(root,'rev-parse','HEAD')){
  root=resolve(root);
  if(realpathSync(root)!==root||!lstatSync(root).isDirectory()||
    git(root,'rev-parse','--show-toplevel')!==root||!/^[a-f0-9]{40}$/.test(head)||
    git(root,'rev-parse','HEAD')!==head||git(root,'rev-parse','HEAD^')!==TARGET.base)refuse('checkout_refused');
  git(root,'diff','HEAD','--exit-code');
  const delta=git(root,'diff','--name-status','--no-renames',TARGET.base,head,'--');
  if(delta!==PUBLIC_FILES.map(path=>'A\t'+path).sort().join('\n'))refuse('checkout_refused');
  for(const path of FROZEN){
    file(resolve(root,path));
    if(git(root,'rev-parse',head+':'+path)!==git(root,'rev-parse',TARGET.base+':'+path))refuse('checkout_refused');
  }
  PUBLIC_FILES.forEach(path=>file(resolve(root,path)));
}

export function checkedHubs(data){
  if(data?.success!==true||!isObject(data.result)||!Array.isArray(data.result.bindings)||data.result.bindings.length>128)
    refuse('hubs_binding_refused');
  const hubs=data.result.bindings.filter(binding=>isObject(binding)&&binding.name===TARGET.binding);
  if(hubs.length!==1||hubs[0].type!=='durable_object_namespace'||hubs[0].class_name!==TARGET.className||
    !/^[a-f0-9]{32}$/.test(hubs[0].namespace_id||'')||
    hubs[0].script_name!==undefined&&hubs[0].script_name!==TARGET.worker||
    hubs[0].dispatch_namespace!==undefined||
    hubs[0].environment!==undefined&&hubs[0].environment!=='production')refuse('hubs_binding_refused');
}
export function checkedCapabilities(data,account){
  if(data?.errors!==undefined&&data.errors!==null&&(!Array.isArray(data.errors)||data.errors.length)){
    // Recognize only documented authorization message families, within a
    // bounded error list. The provider text never becomes public output.
    const denied=Array.isArray(data.errors)&&data.errors.length<=32&&data.errors.some(error=>
      typeof error?.message==='string'&&error.message.length<=2048&&
      /^(?:Unauthorized\b|not authorized for that account\b|zones \[[^\]]*\] are not authorized\b|does not have access to the path\b)/i.test(error.message));
    refuse(denied?'analytics_denied':'analytics_refused');
  }
  const accounts=data?.data?.viewer?.accounts;
  if(!Array.isArray(accounts)||accounts.length!==1||accounts[0]?.accountTag!==account||!isObject(accounts[0]?.settings))
    refuse('analytics_scope_refused');
  let enabled=0;
  for(const name of DATASETS){
    const capability=accounts[0].settings[name];
    if(!isObject(capability)||typeof capability.enabled!=='boolean'||!Array.isArray(capability.availableFields)||
      capability.availableFields.length>512||capability.availableFields.some(field=>typeof field!=='string'||field.length>128||
        !/^[_A-Za-z][_0-9A-Za-z]*$/.test(field))||capability.enabled&&!capability.availableFields.length)refuse('response_invalid');
    if(capability.enabled)enabled++;
  }
  return enabled===DATASETS.length?'capabilities_available':enabled?'capabilities_partial':'capabilities_unavailable';
}

// Existing deployment authentication stays in this one process and reaches
// only these two fixed provider endpoints. Neither credentials nor provider
// bodies, IDs, headers, errors or field lists are returned, logged or saved.
export async function observeCapabilities({account,token,fetcher=globalThis.fetch,timeoutMs=LIMITS.timeoutMs}){
  if(!/^[a-f0-9]{32}$/.test(account||'')||typeof token!=='string'||!token||token.length>4096||/[\r\n]/.test(token))
    return 'credentials_unavailable';
  if(typeof fetcher!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<1)return 'invalid_invocation';
  const controller=new AbortController();let timer,phase='worker',total=0,requests=0;
  const duration=Math.min(timeoutMs,LIMITS.timeoutMs),deadline=performance.now()+duration;
  const active=()=>{if(controller.signal.aborted||performance.now()>=deadline){controller.abort();refuse('timeout');}};
  const expired=new Promise(done=>{timer=setTimeout(()=>{controller.abort();done('timeout');},duration);});
  const cancel=body=>{try{body?.cancel().catch(()=>{});}catch{}};
  const read=async(url,method,body)=>{
    active();
    if(++requests>LIMITS.requests)refuse('invalid_invocation');
    const response=await fetcher(url,{method,redirect:'error',credentials:'omit',signal:controller.signal,
      headers:{Authorization:'Bearer '+token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body}:{})});
    try{active();}catch(error){cancel(response.body);throw error;}
    if(!response.ok){cancel(response.body);refuse(response.status===401||response.status===403?
      phase+'_denied':phase+'_unavailable');}
    if(response.redirected||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||'')){
      cancel(response.body);refuse('response_invalid');
    }
    const length=response.headers.get('content-length');
    if(length!==null&&(!/^\d+$/.test(length)||Number(length)>LIMITS.responseBytes)){cancel(response.body);refuse('response_limit');}
    let reader;
    try{
      reader=response.body.getReader();const chunks=[];let bytes=0,count=0;
      for(;;){
        active();
        const chunk=await reader.read();active();if(chunk.done)break;
        if(!(chunk.value instanceof Uint8Array)||!chunk.value.byteLength)refuse('response_invalid');
        if(++count>LIMITS.responseChunks)refuse('response_limit');
        bytes+=chunk.value.byteLength;total+=chunk.value.byteLength;
        if(bytes>LIMITS.responseBytes||total>LIMITS.totalBytes)refuse('response_limit');
        chunks.push(chunk.value);
      }
      let data;
      try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{refuse('response_invalid');}
      active();return data;
    }catch(error){if(reader){try{reader.cancel().catch(()=>{});}catch{}}throw error;}
    finally{try{reader?.releaseLock();}catch{}}
  };
  try{
    return await Promise.race([expired,(async()=>{
      try{
        const settings=await read(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${TARGET.worker}/settings`,'GET');
        checkedHubs(settings);
        active();
        phase='analytics';
        const capabilities=await read('https://api.cloudflare.com/client/v4/graphql','POST',JSON.stringify({query:QUERY,variables:{accountTag:account}}));
        const output=checkedCapabilities(capabilities,account);active();return output;
      }catch(error){
        if(controller.signal.aborted)return 'timeout';
        return error instanceof Refusal&&classifications.has(error.classification)?error.classification:phase+'_unavailable';
      }
    })()]);
  }finally{clearTimeout(timer);controller.abort();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const mode=process.argv[2],account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;delete process.env.CLOUDFLARE_API_TOKEN;
  let output='invalid_invocation',okay=false;
  try{
    if(process.argv.length!==3||!['verify','read'].includes(mode))refuse('invalid_invocation');
    const head=git(process.cwd(),'rev-parse','HEAD');
    if(mode==='read'||process.env.GITHUB_ACTIONS==='true'){
      output='context_refused';
      const event=JSON.parse(file(process.env.GITHUB_EVENT_PATH));
      if(!authorizedContext(process.env,head,event))refuse('context_refused');
    }
    output='checkout_refused';checkedReleaseHead(process.cwd(),head);
    if(mode==='verify'){
      if(account||token)refuse('invalid_invocation');
      output='checkout_verified';okay=true;
    }else{
      output=await observeCapabilities({account,token});
      okay=['capabilities_available','capabilities_partial','capabilities_unavailable'].includes(output);
    }
  }catch(error){if(error instanceof Refusal&&classifications.has(error.classification))output=error.classification;}
  console.log(output);
  if(!okay)process.exitCode=1;
}
