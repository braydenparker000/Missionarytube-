import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,appendFileSync,lstatSync,existsSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,relative,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {checkedBindings,readWorkerSettings} from './check-music-worker-bindings.mjs';

const REPO='braydenparker000/Missionarytube-',WORKFLOW='.github/workflows/deploy-azure-storage.yml';
const RECIPES=[WORKFLOW,'.github/workflows/qualify-jarvis.yml','scripts/plan-jarvis-qualification.mjs','scripts/install-jarvis-browser.mjs','scripts/worker-release-identity.mjs','scripts/prepare-music-worker.mjs','scripts/prepare-worker-tools.mjs','scripts/check-music-worker-bindings.mjs','scripts/qualified-artifact.mjs','scripts/backup-jarvis-storage.mjs','scripts/overlap-jarvis-prewrite.mjs','scripts/static-publication.mjs','scripts/static-release-loader.js','scripts/azure-static-store.mjs','scripts/publish-jarvis-versioned.mjs','scripts/release-recovery-plan.mjs','scripts/rollback-pair-proof.mjs','scripts/rollback-pair-contracts.mjs','scripts/qualify-jarvis-rollback-pair.mjs','scripts/rollback-pair-runtime.mjs','tests/fixtures/release-recovery/schema-recovery.py'];
const SHA=/^[a-f0-9]{40}$/,DIGEST=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const REASONS=new Set(['receipt_missing','receipt_unavailable','receipt_invalid','origin_mismatch','backend_not_reusable',
  'backend_digest_mismatch','identity_mismatch','settings_mismatch','qualification_unavailable','qualification_mismatch',
  'qualification_incomplete','recipe_mismatch','provider_check_failed','unexpected_error']);
// Only locally created errors can supply a diagnostic. Never inspect arbitrary
// error messages, causes, codes, URLs or provider response bodies for logging.
class IdentityDiagnostic extends Error{
  constructor(reason,message){super(message);this.reason=reason;}
}
const refusal=(reason,message)=>new IdentityDiagnostic(reason,message);
const diagnosticReason=error=>error instanceof IdentityDiagnostic&&REASONS.has(error.reason)?error.reason:'unexpected_error';
const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const blob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
export function backendInputIdentity(source,{bundler,workerConfig}={}){
  const rows=execFileSync('git',['-C',source,'ls-tree','-rz','HEAD'],{encoding:'utf8'}).split('\0').filter(Boolean);
  const tracked=new Map(rows.map(row=>{const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);if(!match)throw Error('Unsupported immutable Worker source type');return [match[3],{mode:match[1],sha:match[2]}];}));
  const entry=path=>{
    const normalized=relative(source,resolve(source,path)).replaceAll('\\','/');
    if(!normalized||normalized.startsWith('../')||normalized==='..')throw Error('Worker input escaped its qualified source');
    const bytes=readFileSync(resolve(source,normalized)),info=lstatSync(resolve(source,normalized));
    if(!info.isFile()||info.isSymbolicLink())throw Error('Unsupported Worker input file type');
    const mode=(info.mode&0o111)?'100755':'100644',git=tracked.get(normalized);
    if(git&&(git.mode!==mode||git.sha!==blob(bytes)))throw Error('Worker input differs from the qualified immutable source');
    return {path:normalized,mode,sha256:hash(bytes)};
  };
  const inspectResolvers=(directory,prefix='')=>{
    for(const item of readdirSync(directory,{withFileTypes:true})){
      if(['.git','node_modules','.wrangler'].includes(item.name))continue;
      const path=prefix+item.name;
      if(item.isDirectory())inspectResolvers(resolve(directory,item.name),path+'/');
      else if(['package.json','tsconfig.json','jsconfig.json'].includes(item.name)&&!tracked.has(path))throw Error('Untracked Worker resolver config was not qualified');
    }
  };
  inspectResolvers(source);
  // Resolve this before invoking esbuild: malformed untracked configs must not
  // escape rejection through the conservative bundle-error fallback.
  for(let directory=dirname(source);;directory=dirname(directory)){
    if(['tsconfig.json','jsconfig.json'].some(name=>existsSync(resolve(directory,name))))throw Error('External Worker resolver config was not qualified');
    if(dirname(directory)===directory)break;
  }
  const config=workerConfig||JSON.parse(readFileSync(resolve(source,'backend/wrangler.music.generated.json'),'utf8'));
  if(config.main!=='worker.js')throw Error('Unexpected qualified Worker entrypoint');
  // Include every backend/config source and both resolver manifests regardless
  // of tree shaking. The bundler additionally discovers the transitive public
  // and dependency graph, rather than maintaining a fragile three-file list.
  const base=[...tracked.keys()].filter(path=>path.startsWith('backend/')||['package.json','package-lock.json'].includes(path));
  base.forEach(entry);
  const resolver=JSON.parse(readFileSync(resolve(source,'package.json'),'utf8'));
  const supportedConfig=new Set(['name','main','compatibility_date','workers_dev','keep_vars','vars','durable_objects','migrations','observability','r2_buckets']);
  // This graph is an independent conservative resolver, not an attestation of
  // Wrangler's bundle. Unknown build/alias/rules/assets/module options always
  // require a fresh actual Wrangler publication, never an inferred skip.
  const resolverSupported=Object.keys(config).every(key=>supportedConfig.has(key))&&resolver.type==='module'&&
    !['imports','exports','browser','main','module'].some(key=>Object.hasOwn(resolver,key));
  const compiler=bundler||createRequire(resolve(source,'package.json'))('esbuild');
  let result;
  try{result=compiler.buildSync({absWorkingDir:source,entryPoints:['backend/worker.js'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:'es2022',logLevel:'silent',external:['cloudflare:workers','node:*']});}
  catch{
    // Unrecognized resolver/plugin/dynamic behavior cannot authorize reuse.
    // Current complete qualification still precedes a fresh actual Worker
    // deployment, whose normal provider checks remain mandatory.
    return {reusable:false,bundled:false,compiler:compiler.version,inputs:[...tracked.keys()].sort().map(entry)};
  }
  if(!result.metafile?.inputs||!Array.isArray(result.outputFiles)||result.outputFiles.length!==1)throw Error('Incomplete Worker bundler identity');
  let reusable=resolverSupported&&!(result.warnings?.length);
  const paths=new Set(base);
  for(const [path,metadata] of Object.entries(result.metafile.inputs)){
    const input=entry(path);paths.add(input.path);
    if(!tracked.has(input.path)){
      if(!input.path.startsWith('node_modules/'))throw Error('Untracked application input was not qualified');
      reusable=false; // package condition/alias resolution may differ in Wrangler
    }
    let directory=dirname(resolve(source,input.path));
    while(directory===source||directory.startsWith(source+'/')){
      for(const name of ['tsconfig.json','jsconfig.json','package.json']){
        const file=resolve(directory,name);if(!existsSync(file))continue;
        const path=relative(source,file).replaceAll('\\','/');
        if(path==='package.json')continue;
        if(!tracked.has(path)&&!path.startsWith('node_modules/'))throw Error('Untracked Worker resolver config was not qualified');
        paths.add(entry(path).path);reusable=false;
      }
      if(directory===source)break;directory=dirname(directory);
    }
    if(!Array.isArray(metadata.imports)||metadata.imports.some(item=>item.kind==='dynamic-import'||(item.external&&!['node:crypto','cloudflare:workers'].includes(item.path))))reusable=false;
    if(/\.[cm]?js$/.test(input.path)){
      const code=readFileSync(resolve(source,input.path),'utf8');
      // Conservative lexical detection catches unresolved import(variable),
      // including comments between keyword and parentheses. False positives
      // only force deployment; strings/comments never grant a skip.
      if(/\b(?:eval|Function)\b/.test(code)||/\b(?:import|require)(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*\(/.test(code))reusable=false;
    }
  }
  const inputs=[...(reusable?paths:new Set([...tracked.keys(),...paths]))].sort().map(entry);
  return {reusable,bundled:true,compiler:compiler.version,bundleSha256:hash(Buffer.from(result.outputFiles[0].contents)),inputs};
}
export function candidateIdentity(root=process.cwd()){
  const source=resolve(root,'.jarvis-source'),release=JSON.parse(readFileSync(resolve(root,'jarvis-release.json'),'utf8'));
  const closure=backendInputIdentity(source);
  const recipe=RECIPES.map(path=>({path,sha:blob(readFileSync(resolve(root,path)))}));
  const backendDigest=hash({schema:2,closure,preparer:recipe.find(x=>x.path==='scripts/prepare-music-worker.mjs').sha,
    generatedConfig:hash(readFileSync(resolve(source,'backend/wrangler.music.generated.json'))),wrangler:'4.136.3'});
  return {schema:1,source:release.commit,orchestration:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),backendDigest,backendReusable:closure.reusable,recipe,
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
  try{
    const settings=await readWorkerSettings({account,token,fetcher});
    const response=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/deployments?per_page=1`,
      {method:'GET',redirect:'error',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error('Active Worker identity could not be verified');
    return {version:activeVersion(await response.json()),settingsDigest:settingsDigest(settings)};
  }catch{throw refusal('provider_check_failed','Live Worker identity could not be verified');}
}
export const receiptDigest=receipt=>hash(JSON.stringify(receipt));
export function checkedFrontendPublication(publication,state,{artifactDigest,backendIdentityDigest}={}){
  if(!publication||!DIGEST.test(publication.releaseId||'')||state?.phase!=='verified'||state.releaseId!==publication.releaseId||
    publication.proof?.kind!=='same-run-configured-artifact'||publication.proof.artifactDigest!==artifactDigest||publication.proof.backendIdentityDigest!==backendIdentityDigest)
    throw Error('Exact versioned frontend publication was not verified');
  return {frontendReleaseId:publication.releaseId,frontendPublicationDigest:hash(publication),activeFrontendPointerDigest:hash(JSON.stringify(publication.pointer)+'\n')};
}
export async function verifyPublishedPointer(expectedDigest,{fetcher=globalThis.fetch}={}){
  try{
    if(!DIGEST.test(expectedDigest||''))throw Error();
    const response=await fetcher('https://missionarytube.z13.web.core.windows.net/jarvis-active-release.json',
      {method:'GET',cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(20000)});
    if(response.status!==200||!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw Error();
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>131072)throw Error();chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
    if(hash(Buffer.concat(chunks,size))!==expectedDigest)throw Error();return true;
  }catch{throw Error('Actual active frontend pointer changed or could not be verified');}
}
export function checkedReuse(receipt,candidate,live,run,tree,jobs){
  const mismatch='Worker receipt does not match actual code, configuration and live provider identity';
  if(!receipt||receipt.schema!==1||receipt.repository!==REPO||!SHA.test(receipt.source||'')||!SHA.test(receipt.orchestration||'')||!DIGEST.test(receipt.backendDigest||'')||!UUID.test(receipt.version||''))throw refusal('receipt_invalid',mismatch);
  if(receipt.backendReusable!==true||candidate.backendReusable!==true)throw refusal('backend_not_reusable',mismatch);
  if(receipt.backendDigest!==candidate.backendDigest)throw refusal('backend_digest_mismatch',mismatch);
  if(receipt.version!==live.version)throw refusal('identity_mismatch',mismatch);
  if(receipt.settingsDigest!==live.settingsDigest)throw refusal('settings_mismatch',mismatch);
  if(receipt.storageOrigin!==candidate.storageOrigin||receipt.apiOrigin!==candidate.apiOrigin)throw refusal('origin_mismatch',mismatch);
  if(!run||run.repository?.full_name!==REPO||run.head_repository?.full_name!==REPO||run.head_repository?.fork===true||
    !['push','workflow_dispatch'].includes(run.event)||run.head_branch!=='main'||run.path!==WORKFLOW||run.head_sha!==receipt.orchestration||
    String(run.id)!==receipt.runId||String(run.run_attempt)!==receipt.attempt)throw refusal('qualification_mismatch','Worker receipt is not from a successful exact production release');
  if(run.status!=='completed'||run.conclusion!=='success')throw refusal('qualification_incomplete','Worker receipt is not from a successful exact production release');
  if(!tree||tree.truncated!==false||!Array.isArray(tree.tree))throw refusal('qualification_incomplete','Worker release recipe mismatch');
  if(JSON.stringify(receipt.recipe)!==JSON.stringify(candidate.recipe))throw refusal('recipe_mismatch','Worker release recipe mismatch');
  for(const entry of candidate.recipe){const files=tree.tree.filter(e=>e.path===entry.path&&e.type==='blob');if(files.length!==1||files[0].sha!==entry.sha)throw refusal('recipe_mismatch','Untrusted immutable production recipe');}
  if(!jobs||!Array.isArray(jobs.jobs)||jobs.total_count!==jobs.jobs.length)throw refusal('qualification_incomplete','Incomplete immutable production job metadata');
  const deploy=jobs.jobs.filter(j=>j.name==='deploy');
  if(deploy.length!==1||deploy[0].run_id!==run.id||deploy[0].run_attempt!==run.run_attempt||deploy[0].head_sha!==receipt.orchestration)throw refusal('qualification_mismatch','Receipt job is not the exact successful production attempt');
  if(deploy[0].status!=='completed'||deploy[0].conclusion!=='success')throw refusal('qualification_incomplete','Receipt job is not the exact successful production attempt');
  const stamps=deploy[0].steps.filter(s=>s.name==='verified-production-receipt-'+receiptDigest(receipt));
  if(stamps.length!==1||stamps[0].status!=='completed'||stamps[0].conclusion!=='success')throw refusal('qualification_incomplete','Mutable receipt is not bound to this production run immutable success metadata');
  return true;
}
export function newlyDeployedVersion(before,after,live){
  if(!Array.isArray(before)||!Array.isArray(after)||before.some(v=>!UUID.test(v.id||''))||after.some(v=>!UUID.test(v.id||'')))throw Error('Invalid Worker version checkpoints');
  const old=new Set(before.map(v=>v.id)),created=after.filter(v=>!old.has(v.id));
  if(created.length!==1||created[0].id!==live.version)throw Error('Actual active Worker is not the uniquely uploaded qualified version');
  return true;
}
async function publicJson(url,fetcher,{unavailable='qualification_unavailable',invalid=unavailable,missing=unavailable}={}){
  const message='Previous successful release proof unavailable';
  let r;
  try{r=await fetcher(url,{method:'GET',redirect:'error',headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(10000)});}
  catch{throw refusal(unavailable,message);}
  if(!r.ok)throw refusal(r.status===404?missing:unavailable,message);
  try{return await r.json();}catch{throw refusal(invalid,message);}
}
export async function findWorkerReuse(candidate,live,{fetcher=globalThis.fetch}={}){
  try{
    if(candidate.storageOrigin!=='https://missionarytube.z13.web.core.windows.net')throw refusal('origin_mismatch','Unexpected receipt origin');
    const receipt=await publicJson(candidate.storageOrigin+'/release-qualified.json',fetcher,{unavailable:'receipt_unavailable',invalid:'receipt_invalid',missing:'receipt_missing'});
    if(!receipt||!/^[1-9][0-9]{0,14}$/.test(receipt.runId||'')||!/^[1-9][0-9]{0,5}$/.test(receipt.attempt||'')||!SHA.test(receipt.orchestration||''))throw refusal('receipt_invalid','Invalid production receipt');
    const run=await publicJson(`https://api.github.com/repos/${REPO}/actions/runs/${receipt.runId}`,fetcher);
    const tree=await publicJson(`https://api.github.com/repos/${REPO}/git/trees/${receipt.orchestration}?recursive=1`,fetcher);
    const jobs=await publicJson(`https://api.github.com/repos/${REPO}/actions/runs/${receipt.runId}/attempts/${receipt.attempt}/jobs?per_page=100`,fetcher);
    checkedReuse(receipt,candidate,live,run,tree,jobs);
    return {reuse:true,runId:receipt.runId,attempt:receipt.attempt,version:live.version};
  }catch(error){return {reuse:false,reason:diagnosticReason(error)};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const command=process.argv[2],candidate=candidateIdentity(),live=await liveIdentity({account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN});
    if(command==='plan'){
      const proof=await findWorkerReuse(candidate,live);
      writeFileSync('worker-identity-before.json',JSON.stringify({candidate,live,proof},null,2)+'\n');
      writeFileSync('worker-identity-planned.json',JSON.stringify({schema:1,candidate,beforeLive:live},null,2)+'\n');
      if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'deploy='+!proof.reuse+'\n');
      console.log(proof.reuse?'Actual active Worker and configuration match a verified successful production release':`No exact live Worker reuse proof (${proof.reason}); current qualified backend deployment required`);
    }else if(command==='record'){
      const before=JSON.parse(readFileSync('worker-identity-before.json','utf8'));
      if(before.proof.reuse){
        if(JSON.stringify(before.live)!==JSON.stringify(live)||before.candidate.backendDigest!==candidate.backendDigest)throw Error('Previously qualified Worker changed before recording');
      }else newlyDeployedVersion(JSON.parse(readFileSync('.jarvis-source/worker-versions-before.json','utf8')),JSON.parse(readFileSync('.jarvis-source/worker-versions-after.json','utf8')),live);
      const current={candidate,live};writeFileSync('worker-identity-current.json',JSON.stringify(current,null,2)+'\n');
      if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'digest='+hash(current)+'\n');
    }else if(command==='verify-planned'){
      const expected=JSON.parse(readFileSync('worker-identity-planned.json','utf8'));
      if(JSON.stringify(expected.candidate)!==JSON.stringify(candidate)||JSON.stringify(expected.beforeLive)!==JSON.stringify(live))throw Error('Backend changed after read-only prewrite qualification');
    }else if(command==='verify'){
      const expected=JSON.parse(readFileSync('worker-identity-current.json','utf8'));
      const planned=JSON.parse(readFileSync('worker-identity-planned.json','utf8'));
      if(JSON.stringify(expected.candidate)!==JSON.stringify(candidate)||JSON.stringify(planned.candidate)!==JSON.stringify(candidate)||expected.live.version!==live.version||expected.live.settingsDigest!==live.settingsDigest||
        expected.live.settingsDigest!==planned.beforeLive.settingsDigest||process.env.EXPECTED_BACKEND_IDENTITY_DIGEST&&hash(expected)!==process.env.EXPECTED_BACKEND_IDENTITY_DIGEST)throw Error('Live Worker changed during release; frontend promotion stopped');
    }else if(command==='receipt'){
      const expected=JSON.parse(readFileSync('worker-identity-current.json','utf8'));
      if(JSON.stringify(expected.live)!==JSON.stringify(live))throw Error('Live Worker changed after final frontend verification');
      const receipt={...candidate,repository:REPO,...live,runId:String(process.env.GITHUB_RUN_ID),attempt:String(process.env.GITHUB_RUN_ATTEMPT)};
      const configured=JSON.parse(readFileSync('configured-artifact.json','utf8'));
      receipt.frontendArtifactDigest=receiptDigest(configured);
      receipt.publicConfigurationDigest=hash(configured.files.filter(f=>['assets/quick-ai-config.json','assets/drive-config.json'].includes(f.path)));
      const publication=JSON.parse(readFileSync('.publication/candidate/plan.json','utf8')),state=JSON.parse(readFileSync('.publication/state.json','utf8'));
      const planned=JSON.parse(readFileSync('worker-identity-planned.json','utf8'));
      if(JSON.stringify(expected.candidate)!==JSON.stringify(planned.candidate)||expected.live.settingsDigest!==planned.beforeLive.settingsDigest)throw Error('Actual backend differs from the qualified prewrite contract');
      receipt.actualBackendIdentityDigest=hash(expected);
      Object.assign(receipt,checkedFrontendPublication(publication,state,{artifactDigest:receipt.frontendArtifactDigest,backendIdentityDigest:hash(planned)}));
      await verifyPublishedPointer(receipt.activeFrontendPointerDigest);
      writeFileSync('release-qualified.json',JSON.stringify(receipt,null,2)+'\n');
      if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'digest='+receiptDigest(receipt)+'\n');
    }else if(command==='verify-receipt'){
      const receipt=JSON.parse(readFileSync('release-qualified.json','utf8'));
      if(receiptDigest(receipt)!==process.env.EXPECTED_RECEIPT_DIGEST||receipt.backendDigest!==candidate.backendDigest||receipt.version!==live.version||receipt.settingsDigest!==live.settingsDigest)throw Error('Production receipt changed before its immutable success stamp');
      await verifyPublishedPointer(receipt.activeFrontendPointerDigest);
    }else throw Error('Use plan, record, verify or receipt');
  }catch(error){console.error(`Worker identity qualification failed (${diagnosticReason(error)}); no frontend promotion is authorized`);process.exitCode=1;}
}
