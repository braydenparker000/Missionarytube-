import {createHash} from 'node:crypto';
import {readFile,readdir,lstat,mkdir,writeFile} from 'node:fs/promises';
import {join,dirname,posix} from 'node:path';

export const POINTER='jarvis-active-release.json';
export const ROOT='_jarvis/releases/';
export const LOADER='jarvis-release-loader-v1.js';
export const RELEASE_MANIFEST='publication-manifest.json';
const PODCAST_SHARED=['assets/config.js','assets/shell.css','assets/premium.css'];
export const sha256=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
export const mimeFor=path=>({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2',
  '.ttf':'font/ttf','.otf':'font/otf','.txt':'text/plain; charset=utf-8'})[posix.extname(path)]||'application/octet-stream';
export function safePath(path){
  if(typeof path!=='string'||path.length>1024||!path||!/^[A-Za-z0-9_./-]+$/.test(path)||path.startsWith('/')||path.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Unsafe publication path');
  return path;
}
export async function readTree(directory){
  const result=new Map();
  async function walk(dir,prefix=''){
    for(const name of (await readdir(dir)).sort()){
      const file=join(dir,name),info=await lstat(file),path=prefix+name;safePath(path);
      if(info.isSymbolicLink())throw Error('Publication symlinks forbidden');
      if(info.isDirectory())await walk(file,path+'/');
      else if(info.isFile())result.set(path,await readFile(file));else throw Error('Unexpected publication file');
    }
  }
  await walk(directory);return result;
}
export const inventory=files=>[...files].map(([path,bytes])=>({path,bytes:bytes.length,sha256:sha256(bytes),contentType:mimeFor(path)})).sort((a,b)=>a.path.localeCompare(b.path));
function csp(html){
  const matches=[...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*>/gi)];
  if(matches.length!==1)throw Error('Exactly one existing document CSP required');
  // Loader and application share this policy. Never add inline/eval allowances.
  const policy=matches[0][1];
  if(!/script-src[^;]*'self'/.test(policy)||!/connect-src[^;]*(?:'self'|https:)/.test(policy))throw Error('Existing document policy cannot load static releases');
  return policy;
}
function loaderDocument(path,policy){
  return Buffer.from('<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'+
    '<meta http-equiv="Content-Security-Policy" content="'+policy+'"><meta name="referrer" content="strict-origin-when-cross-origin">'+
    '<meta name="jarvis-document" content="'+path+'"><title>Jarvis</title><script defer src="/'+LOADER+'"></script></head>'+
    '<body><noscript>Enable JavaScript to open Jarvis.</noscript></body></html>\n');
}
// Only shipped static resources are remapped. API endpoints, canonical links,
// local-storage keys, CSS and markup remain as supplied by the pinned frontend.
// The canonical podcast SW is an explicit frozen contract: Azure cannot grant
// a versioned SW script a broader canonical scope with a custom response header.
export function versionText(text,path,paths,prefix){
  if(path==='podcasts/sw.js')return text;
  const nonHTML=[...paths].filter(p=>!p.endsWith('.html')&&p!=='podcasts/sw.js');
  const roots=[...new Set(nonHTML.map(p=>p.startsWith('assets/')?'assets/':p.startsWith('media/assets/')?'media/assets/':null).filter(Boolean))].sort((a,b)=>b.length-a.length);
  for(const root of roots)text=text.replace(new RegExp('(?<![A-Za-z0-9:/])/'+root.replaceAll('/','\\/'),'g'),prefix+root);
  for(const file of nonHTML.filter(p=>!roots.some(root=>p.startsWith(root))).sort((a,b)=>b.length-a.length)){
    const pattern=file.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    text=text.replace(new RegExp('(?<![A-Za-z0-9:/])/'+pattern+'(?=[?\\x22\\x27\\x60\\s<)]|$)','g'),prefix+file);
  }
  if(path.endsWith('.html'))text=text.replace(/\b(src|href)=(['"])([^'"<>]+)\2/gi,(all,attr,quote,value)=>{
    if(value.startsWith('/')||/^(?:[a-z]+:|#)/i.test(value))return all;
    const target=posix.normalize(posix.join(posix.dirname(path),value.split(/[?#]/)[0]));
    if(!paths.has(target)||target.endsWith('.html'))return all;
    return attr+'='+quote+prefix+target+value.slice(value.split(/[?#]/)[0].length)+quote;
  });
  // Dynamic Astra compatibility scripts are relative to /media/, rather than
  // their JS file. Modules and decoder URLs relative to import.meta/currentScript
  // already resolve inside the namespace and are left alone.
  if(path.startsWith('media/')&&path.endsWith('.js'))text=text.replace(/(['"`])assets\//g,'$1'+prefix+'media/assets/');
  return text;
}
export function buildPublication(input,{proof,recipe,loader}={}){
  if(!(input instanceof Map)||input.size<1||input.size>10000||!input.has('index.html'))throw Error('Bounded complete frontend required');
  let total=0;for(const [path,bytes] of input){safePath(path);total+=bytes.length;
    if(path===POINTER||path===LOADER||path===RELEASE_MANIFEST||path.startsWith(ROOT)||/\.(?:mp4|mkv|webm|mp3|opus|flac|wav)$/i.test(path))throw Error('Reserved release path or media payload');
  }
  if(total>64*1024*1024||!proof||!recipe||!Buffer.isBuffer(loader))throw Error('Bounded proof and publication recipe required');
  const inputFiles=inventory(input),inputDigest=sha256(inputFiles),loaderDigest=sha256(loader);
  const releaseId=sha256({schema:1,proof,inputDigest,recipe,loaderDigest}),prefix='/'+ROOT+releaseId+'/';
  const payload=new Map(),canonical=new Map([[LOADER,loader]]),policies={};
  const frozenPodcast=input.has('podcasts/sw.js');
  const frozen=frozenPodcast?[...input.keys()].filter(p=>p.startsWith('podcasts/')||PODCAST_SHARED.includes(p)):[];
  for(const [path,bytes] of input){
    if(path.endsWith('.html')){policies[path]=csp(bytes.toString('utf8'));canonical.set(path,frozen.includes(path)?bytes:loaderDocument(path,policies[path]));}
    if(frozen.includes(path))canonical.set(path,bytes);
    payload.set(path,/\.(?:html|js|mjs|css)$/.test(path)?Buffer.from(versionText(bytes.toString('utf8'),path,new Set(input.keys()),prefix)):bytes);
  }
  const files=inventory(payload),documents=files.filter(f=>f.path.endsWith('.html')).map(({path,sha256,bytes})=>({path,sha256,bytes}));
  if(documents.length>256||documents.some(d=>d.bytes>2097152))throw Error('Bounded release document inventory required');
  const pointer={schema:1,releaseId,prefix,proofDigest:sha256(proof),manifestDigest:sha256(files),documents};
  const plan={schema:1,releaseId,prefix,proof,inputDigest,inputFiles,recipe,loaderDigest,files,canonical:inventory(canonical),frozenCanonical:inventory(new Map(frozen.map(p=>[p,input.get(p)]))),policies,pointer};
  return {plan,payload,canonical};
}
export function compatibleLoaders(previous,candidate){
  if(JSON.stringify(previous.plan.canonical)!==JSON.stringify(candidate.plan.canonical))throw Error('Canonical loader/policy/route change requires a separately reviewed migration');
  const before=previous.payload.get('podcasts/sw.js'),after=candidate.payload.get('podcasts/sw.js');
  if(Boolean(before)!==Boolean(after)||(before&&sha256(before)!==sha256(after)))throw Error('Canonical service-worker contract changed');
  return true;
}
export async function savePublication(publication,directory){
  await mkdir(directory,{recursive:true});
  for(const [kind,files] of [['payload',publication.payload],['canonical',publication.canonical]])for(const [path,bytes] of files){const target=join(directory,kind,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);}
  await writeFile(join(directory,'plan.json'),JSON.stringify(publication.plan,null,2)+'\n');
}
export async function loadPublication(directory){
  const plan=JSON.parse(await readFile(join(directory,'plan.json'),'utf8')),payload=await readTree(join(directory,'payload')),canonical=await readTree(join(directory,'canonical'));
  if(plan.schema!==1||plan.prefix!=='/'+ROOT+plan.releaseId+'/'||JSON.stringify(inventory(payload))!==JSON.stringify(plan.files)||JSON.stringify(inventory(canonical))!==JSON.stringify(plan.canonical))throw Error('Publication seal changed');
  if(sha256({schema:1,proof:plan.proof,inputDigest:plan.inputDigest,recipe:plan.recipe,loaderDigest:plan.loaderDigest})!==plan.releaseId||
    sha256(plan.inputFiles)!==plan.inputDigest||sha256(canonical.get(LOADER))!==plan.loaderDigest||sha256(plan.files)!==plan.pointer.manifestDigest||
    JSON.stringify(plan.pointer)!==JSON.stringify({schema:1,releaseId:plan.releaseId,prefix:plan.prefix,proofDigest:sha256(plan.proof),manifestDigest:sha256(plan.files),documents:plan.files.filter(f=>f.path.endsWith('.html')).map(({path,sha256,bytes})=>({path,sha256,bytes}))}))throw Error('Publication identity changed');
  const frozen=plan.inputFiles.some(f=>f.path==='podcasts/sw.js')?plan.inputFiles.filter(f=>f.path.startsWith('podcasts/')||PODCAST_SHARED.includes(f.path)):[];
  if(JSON.stringify(frozen)!==JSON.stringify(plan.frozenCanonical))throw Error('Frozen canonical contract changed');
  return {plan,payload,canonical};
}
const normalizedMIME=type=>{const parts=(type||'').toLowerCase().split(';').map(p=>p.trim());if(parts.slice(1).some(p=>p.startsWith('charset=')&&!/^charset=(?:"?utf-8"?)$/.test(p)))return '';return parts[0]==='application/javascript'?'text/javascript':parts[0];};
function matches(actual,bytes,type){return actual&&bytes&&normalizedMIME(actual.contentType)===normalizedMIME(type)&&actual.bytes.length===bytes.length&&sha256(actual.bytes)===sha256(bytes);}
export async function verifyRelease(publication,store,{canonical=false}={}){
  if(!matches(await store.get(ROOT+publication.plan.releaseId+'/'+RELEASE_MANIFEST),Buffer.from(JSON.stringify(publication.plan)+'\n'),mimeFor(RELEASE_MANIFEST)))throw Error('Immutable publication manifest differs');
  for(const [path,bytes] of publication.payload)if(!matches(await store.get(ROOT+publication.plan.releaseId+'/'+path),bytes,mimeFor(path)))throw Error('Immutable bytes or MIME differ');
  for(const file of publication.plan.frozenCanonical){
    const actual=await store.get(file.path);
    if(!actual||normalizedMIME(actual.contentType)!==normalizedMIME(file.contentType)||actual.bytes.length!==file.bytes||sha256(actual.bytes)!==file.sha256)throw Error('Frozen canonical podcast/offline contract differs');
  }
  for(const [path,bytes] of canonical?publication.canonical:[])if(!matches(await store.get(path),bytes,mimeFor(path)))throw Error('Canonical loader bytes or MIME differ');
  if(canonical)for(const [path,bytes] of publication.canonical)if(path==='index.html'||path.endsWith('/index.html')){
    const route=path==='index.html'?'':path.slice(0,-10);
    if(!matches(await store.route(route),bytes,mimeFor(path)))throw Error('Canonical directory route differs');
  }
  if(publication.payload.has('podcasts/sw.js')&&!matches(await store.get('podcasts/sw.js'),publication.payload.get('podcasts/sw.js'),mimeFor('podcasts/sw.js')))throw Error('Canonical service-worker contract differs');
  // Azure directory index behavior is independently checked, not inferred from
  // the file inventory. Mock and provider stores implement the same route read.
  for(const [path,bytes] of publication.payload)if(path.endsWith('/index.html')){
    const route=ROOT+publication.plan.releaseId+'/'+path.slice(0,-10);
    if(!matches(await store.route(route),bytes,mimeFor(path)))throw Error('Immutable directory route differs');
  }
}
export async function stageRelease(publication,store,{checkpoint=async()=>{}}={}){
  let completed=0;
  for(const [path,bytes] of publication.payload){
    const key=ROOT+publication.plan.releaseId+'/'+path,actual=await store.get(key),type=mimeFor(path);
    if(actual){if(!matches(actual,bytes,type))throw Error('Immutable namespace conflict; overwrite refused');}
    else await store.put(key,bytes,type,{ifNoneMatch:'*'});
    if(!matches(await store.get(key),bytes,type))throw Error('Staged bytes or MIME differ');
    // If the runner dies before this checkpoint, resume reads provider bytes.
    await checkpoint({phase:'staging',releaseId:publication.plan.releaseId,completed:++completed,total:publication.payload.size});
  }
  const manifestKey=ROOT+publication.plan.releaseId+'/'+RELEASE_MANIFEST,manifestBytes=Buffer.from(JSON.stringify(publication.plan)+'\n'),current=await store.get(manifestKey);
  if(current&&!matches(current,manifestBytes,mimeFor(RELEASE_MANIFEST)))throw Error('Immutable publication manifest conflict');
  if(!current)await store.put(manifestKey,manifestBytes,mimeFor(RELEASE_MANIFEST),{ifNoneMatch:'*'});
  await verifyRelease(publication,store);return {phase:'staged',releaseId:publication.plan.releaseId,completed};
}
export async function switchPointer(target,store,{expected,guard,checkpoint=async()=>{}}={}){
  await verifyRelease(target,store,{canonical:true});
  const bytes=Buffer.from(JSON.stringify(target.plan.pointer)+'\n'),live=await store.get(POINTER);
  if(matches(live,bytes,mimeFor(POINTER))){await guard();return {phase:'selected',releaseId:target.plan.releaseId,reconciled:true};}
  if(!expected||((live?.etag??null)!==expected.etag)||((live?sha256(live.bytes):null)!==expected.sha256))throw Error('Active pointer changed; mutation refused');
  await guard(); // Actual backend/config, sealed artifact, readiness and approvals.
  await store.put(POINTER,bytes,mimeFor(POINTER),live?{ifMatch:live.etag}:{ifNoneMatch:'*'});
  const after=await store.get(POINTER);
  if(!matches(after,bytes,mimeFor(POINTER)))throw Error('Pointer result unknown; inspect before resume or rollback');
  await checkpoint({phase:'selected',releaseId:target.plan.releaseId});
  return {phase:'selected',releaseId:target.plan.releaseId,reconciled:false};
}
export async function installLoaders(previous,candidate,store,{guard,checkpoint=async()=>{}}={}){
  compatibleLoaders(previous,candidate);
  await verifyRelease(previous,store);await verifyRelease(candidate,store);
  await guard();
  // The initial pointer selects the frozen old site before any canonical page
  // changes. Until the single later promotion, every loader still serves it.
  const bytes=Buffer.from(JSON.stringify(previous.plan.pointer)+'\n'),active=await store.get(POINTER);
  if(active&&!matches(active,bytes,mimeFor(POINTER)))throw Error('Bootstrap pointer differs');
  if(!active)await store.put(POINTER,bytes,mimeFor(POINTER),{ifNoneMatch:'*'});
  const order=[LOADER,...[...previous.canonical.keys()].filter(p=>p!==LOADER&&p!=='index.html'),'index.html'];
  for(const path of order){
    const bytes=previous.canonical.get(path),type=mimeFor(path),live=await store.get(path);
    if(!matches(live,bytes,type)){
      if(path!==LOADER&&!path.endsWith('.html'))throw Error('Frozen canonical asset differs; overwrite refused');
      if(path!==LOADER&&(!live||!matches(live,previous.original?.get(path),type)))throw Error('Canonical legacy document drifted');
      if(path===LOADER&&live)throw Error('Canonical loader conflict');
      await store.put(path,bytes,type,live?{ifMatch:live.etag}:{ifNoneMatch:'*'});
    }
    await checkpoint({phase:'bootstrap',releaseId:previous.plan.releaseId});
  }
  await verifyRelease(previous,store,{canonical:true});
}
