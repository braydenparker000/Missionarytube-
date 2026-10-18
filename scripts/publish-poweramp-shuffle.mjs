import {canonicalDigest} from './lucy-settings-diagnostic.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,appendFile,mkdtemp,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {immutableSourceSnapshot,recipeAllowed,trustedRecipe} from './plan-jarvis-qualification.mjs';
import {liveIdentity,receiptDigest} from './worker-release-identity.mjs';
export const SOURCE='23bcf625813eb654f0b21956bc443a660f913a72';
export const PARENT='6f7d3875623fca4aac2a0a1f93ece3edaf4e84c8566103ed9a0656ce2b44de69';
// Worker checkpoint (seq-247 pattern, docs/mobile-file-save-release.md): the
// canonical parent receipt predates the accepted Worker upload (run
// 39105451222, version #106). The parent receipt is NOT mutated or
// rebaselined. This checkpoint reconciles the current accepted Worker
// identity. The values below are the true {version, settingsDigest} captured
// by the exact liveIdentity() gate functions in authorized read-only run
// 39160117643 (artifact worker-identity-39160117643), stable over two reads.
// backendReusable:false — checkpoint identity only, never the full-release
// bundler closure/reuse proof.
export const WORKER_CHECKPOINT={version:'c0e05a13-f0cb-44a6-995d-7a954aab5930',settingsDigest:'37154ad84e6a3c6596a4e7f5bb1e4b17575976337dc34600bf1632f33238bd01',acceptedRun:39105451222,evidenceRun:39160117643};
export const FILES=JSON.parse(readFileSync(new URL('./poweramp-shuffle-file-pins.json',import.meta.url)));
// Reviewed finite recipe: adds the mandatory shuffle latency test to the
// existing serial performance lane; verifier and browser installer stay pinned.
const SHUFFLE_RECIPE={...trustedRecipe,'.github/workflows/validate-r2.yml':'9a352d9671250bbdcb8701a6065905219442f0e0','tests/helpers/ci-test-inventory.mjs':'ea4b765d4b510cf7e1cafd9a84526924bbaa4e86'};
const ORIGIN='https://missionarytube.z13.web.core.windows.net',ROOT=resolve('.poweramp-source');
// Post-import (PR #216) the Jarvis application tree lives under jarvis/ inside
// the source checkout; qualification and file paths resolve beneath it, while
// the immutable snapshot still covers the whole checkout.
const JARVIS=resolve(ROOT,'jarvis');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitBlob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
// Content fingerprinting for immutable caching (perf overhaul). Hashed blob
// names are derived deterministically from the exact source bytes: the pins
// file remains the reviewed snapshot, and source() fail-closes if the derived
// names ever diverge from it. FP_LEN=12 hex chars (48 bits) is ample for a
// small static asset set; collisions would fail closed at the pins check.
const FP_LEN=12;
const fpFragment=bytes=>hash(bytes).slice(0,FP_LEN);
// Logical source path -> fingerprinted live path. Only player.js and the font
// files are fingerprinted; index.html is the fixed entry point (no-cache) and
// shuffle-worker.js is pinned unhashed (skipped-untouched).
export function fingerprintedPath(logical,bytes){
  if(logical==='drawercast/player.js') return `drawercast/player.${fpFragment(bytes)}.js`;
  const m=logical.match(/^drawercast\/fonts\/(.+)\.woff$/);
  if(m) return `drawercast/fonts/${m[1]}.${fpFragment(bytes)}.woff`;
  throw new Error('Not a fingerprinted asset: '+logical);
}
// Derive every fingerprinted live path from the exact source bytes.
export async function expectedFingerprints(){
  const out={};
  const {readdir}=await import('node:fs/promises');
  out['drawercast/player.js']=fingerprintedPath('drawercast/player.js',await readFile(resolve(JARVIS,'public','drawercast/player.js')));
  for(const f of (await readdir(resolve(JARVIS,'public','drawercast/fonts'))).sort()){
    if(!f.endsWith('.woff')) continue;
    const logical=`drawercast/fonts/${f}`;
    out[logical]=fingerprintedPath(logical,await readFile(resolve(JARVIS,'public',logical)));
  }
  return out;
}
// Exact upload bytes for a FILES entry. player.js and fonts upload byte-identical
// to source; index.html is rewritten to reference the fingerprinted asset names.
export async function uploadBytes(file){
  const logical=file.logical||file.path;
  if(file.path==='drawercast/index.html'){
    const playerFile=FILES.find(f=>/^drawercast\/player\.[0-9a-f]{12}\.js$/.test(f.path));
    assert.ok(playerFile,'Fingerprinted player missing from FILES');
    let html=await readFile(resolve(JARVIS,'public',logical),'utf8');
    html=html.replace(/\.\/player\.js(\?[^"']*)?/,'./'+playerFile.path.split('/').pop());
    for(const f of FILES){
      const m=f.path.match(/^drawercast\/fonts\/(.+)\.[0-9a-f]{12}\.woff$/);
      if(m) html=html.split(`./fonts/${m[1]}.woff`).join('./fonts/'+f.path.split('/').pop());
    }
    assert.ok(!html.includes('base64'),'Fingerprinted index.html still carries inline font data');
    return {bytes:Buffer.from(html,'utf8'),contentType:'text/html'};
  }
  const bytes=await readFile(resolve(JARVIS,'public',logical));
  const contentType=file.contentType||(logical.endsWith('.woff')?'font/woff':logical.endsWith('.html')?'text/html':'application/javascript');
  return {bytes,contentType};
}
// Blob names that are old versions of managed fingerprinted assets: the legacy
// unhashed player.js, superseded player.<hash>.js blobs, and stale font blobs.
// Used by the store guard (expected absent after cleanup) and by publish()
// (deletes them after the new files verify).
export function isSupersededAsset(name,filePaths){
  if(filePaths.has(name)) return false;
  if(name==='drawercast/player.js') return true;
  if(/^drawercast\/player\.[0-9a-f]{12}\.js$/.test(name)) return true;
  if(name.startsWith('drawercast/fonts/')) return true;
  return false;
}
const CACHE_IMMUTABLE='public, max-age=31536000, immutable';
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
const local=async p=>JSON.parse(await readFile(p,'utf8'));
async function get(path){const r=await fetch(ORIGIN+'/'+path,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);return r;}
// Destination-repository exact-source qualification proof. The pinned source is
// a braydenparker000/Missionarytube- commit, so the frozen proof module's
// braydenparker999/jarvis workflow lookup can never authenticate it. This
// verifies the qualification that actually ran on the exact source: the
// Validate (ci.yml) push run on main, bound to the reproduced qualification
// plan (release-pinned source tree + trusted recipe bytes + declared
// environment) whose component digests the CI stamped into its job names, and
// to the reviewed destination CI definition bytes. Public GitHub metadata
// only; no auth, no artifacts, bounded reads.
const DEST_REPOSITORY='braydenparker000/Missionarytube-';
const DEST_WORKFLOW='.github/workflows/ci.yml';
const DEST_COMPONENTS=['relay','frontend','poweramp','blankLibrary','podcasts','migration','performance','owner24'];
// Reviewed destination CI definition, pinned as git blob SHAs at SOURCE. The
// reusable qualify-jarvis.yml is referenced relatively by ci.yml, so it
// resolves at the run's head SHA; verifying all three files at head_sha
// enforces that the green jobs came from exactly this reviewed definition.
export const DEST_DEFINITION_PINS={
 '.github/workflows/ci.yml':'8cd2f79ad9b975a3068f40dc9b923950e82ce157',
 '.github/workflows/qualify-jarvis.yml':'8acf49862de98777d5efda625fc39b666190caea',
 'scripts/plan-jarvis-qualification.mjs':'eee6f0e67f2fab11c650dbf80cb8b60d5f7e3a23',
};
// Environment the destination CI declares for qualification: qualify-jarvis.yml
// pins setup-node 22.23.3 / 24.21.0 and setup-python 3.12.15, and the browser
// identity is the pinned BROWSER_IDENTITY constant.
const DEST_PLAN_ENV={QUALIFICATION_NODE22:'v22.23.3',QUALIFICATION_NODE24:'v24.21.0',QUALIFICATION_PYTHON:'Python 3.12.15'};
const DEST_PLAN_MODULES=['scripts/qualification-proof.mjs','scripts/install-qualification-browser.mjs','tests/helpers/ci-test-inventory.mjs'];
async function destinationJson(path,fetcher){
 const response=await (fetcher||fetch)('https://api.github.com'+path,{method:'GET',redirect:'error',
  headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(15000)});
 assert.equal(response.status,200,'Destination qualification proof unavailable');return response.json();
}
// Reproduce the destination CI's qualification plan for the release-pinned
// source tree. The CI materialized jarvis-release.json's commit as
// .jarvis-source, verified the trusted recipe bytes, then ran the frozen
// makePlan over that tree with the declared environment. Every input here is
// pinned or recomputed from the immutable source: a run whose jobs carry
// different digests — from a stale plan, a different tree, or a different
// runtime — cannot pass the lane binding below.
export async function destinationPlan(fetcher,root=ROOT){
 const release=JSON.parse(await readFile(resolve(root,'jarvis-release.json'),'utf8'));
 assert.match(release.commit||'',/^[a-f0-9]{40}$/,'Release pin is not an exact commit');
 const tree=await destinationJson(`/repos/${DEST_REPOSITORY}/git/trees/${release.commit}?recursive=1`,fetcher);
 assert.equal(tree.truncated,false,'Incomplete release source tree');
 assert.ok(Array.isArray(tree.tree)&&tree.tree.length>0,'Invalid release source tree');
 assert.ok(!tree.tree.some(e=>e.type==='commit'),'Release source contains a submodule');
 const blobs=tree.tree.filter(e=>e.type==='blob');
 assert.ok(blobs.length>0&&blobs.every(e=>['100644','100755'].includes(e.mode)),'Unexpected release source file mode');
 for(const [path,pin] of Object.entries(trustedRecipe)){
  const found=blobs.filter(e=>e.path===path);
  assert.equal(found.length,1,'Release qualification recipe file missing or duplicated: '+path);
  assert.equal(found[0].sha,pin,'Release qualification recipe differs from the trusted pins: '+path);
 }
 const dir=await mkdtemp(join(tmpdir(),'dest-qual-plan-'));
 try{
  for(const path of DEST_PLAN_MODULES){
   const file=await destinationJson(`/repos/${DEST_REPOSITORY}/contents/${path}?ref=${release.commit}`,fetcher);
   assert.equal(file.sha,trustedRecipe[path],'Recipe module bytes changed between tree and fetch: '+path);
   assert.equal(file.encoding,'base64','Unexpected recipe module encoding: '+path);
   const bytes=Buffer.from(file.content,'base64');
   // Recompute the Git blob hash of the decoded bytes: these bytes are
   // imported and executed below, so the API's sha field alone is not trusted.
   assert.equal(gitBlob(bytes),trustedRecipe[path],'Recipe module bytes do not hash to the trusted pin: '+path);
   const target=resolve(dir,path);
   await mkdir(dirname(target),{recursive:true});
   await writeFile(target,bytes);
  }
  const q=await import(pathToFileURL(resolve(dir,'scripts/qualification-proof.mjs')));
  return q.makePlan(blobs.map(({path,sha,mode})=>({path,sha,mode})),q.declaredEnvironment(dir,DEST_PLAN_ENV));
 }finally{await rm(dir,{recursive:true,force:true});}
}
export async function findDestinationProof(sourceSha,plan,fetcher){
 assert.match(sourceSha,/^[a-f0-9]{40}$/,'An exact source SHA is required');
 assert.ok(plan&&plan.schema===1&&plan.components&&plan.environment,'A reproduced destination qualification plan is required');
 const runs=await destinationJson(`/repos/${DEST_REPOSITORY}/actions/runs?head_sha=${sourceSha}&event=push&per_page=10`,fetcher);
 const candidates=(runs.workflow_runs||[]).filter(run=>
  run.repository?.full_name===DEST_REPOSITORY&&run.head_repository?.full_name===DEST_REPOSITORY&&run.head_repository?.fork!==true&&
  run.event==='push'&&run.head_branch==='main'&&run.path===DEST_WORKFLOW&&run.head_sha===sourceSha&&
  run.status==='completed'&&run.conclusion==='success'&&
  Number.isSafeInteger(run.id)&&run.id>=1&&Number.isSafeInteger(run.run_attempt)&&run.run_attempt>=1);
 assert.ok(candidates.length>0,'No successful destination qualification run for the exact source');
 const run=candidates.sort((a,b)=>b.id-a.id)[0];
 for(const [path,pin] of Object.entries(DEST_DEFINITION_PINS)){
  const file=await destinationJson(`/repos/${DEST_REPOSITORY}/contents/${path}?ref=${run.head_sha}`,fetcher);
  assert.equal(file.sha,pin,'Destination CI definition differs from the reviewed bytes: '+path);
 }
 const page=await destinationJson(`/repos/${DEST_REPOSITORY}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,fetcher);
 const jobs=Array.isArray(page.jobs)?page.jobs:[];
 assert.ok(Number.isSafeInteger(page.total_count)&&page.total_count===jobs.length,'Incomplete destination qualification job page');
 for(const job of jobs){
  assert.equal(job.run_id,run.id,'Qualification job from another run');
  assert.equal(job.run_attempt,run.run_attempt,'Qualification job from another attempt');
  assert.equal(job.head_sha,run.head_sha,'Qualification job from another source');
 }
 for(const name of ['static-checks / plan','static-checks / build','static-checks / qualification']){
  const found=jobs.filter(j=>j.name===name);
  assert.equal(found.length,1,'Missing or duplicated destination qualification job: '+name);
  assert.equal(found[0].status,'completed','Destination qualification job not completed: '+name);
  assert.equal(found[0].conclusion,'success','Destination qualification job not successful: '+name);
 }
 // Each component lane must carry exactly the digest of the reproduced plan:
 // the digest hashes the release-pinned source tree, the trusted recipe, and
 // the declared environment, so a stale plan, a different tree, or a different
 // runtime cannot produce a passing lane. Exactly one lane per component.
 for(const name of DEST_COMPONENTS){
  const digest=plan.components[name]&&plan.components[name].digest;
  assert.match(digest||'',/^[a-f0-9]{64}$/,'Reproduced plan missing component digest: '+name);
  const prefix=`static-checks / component (${name}, ${digest},`;
  const found=jobs.filter(j=>typeof j.name==='string'&&j.name.startsWith(prefix));
  assert.equal(found.length,1,'Missing, duplicated, or plan-mismatched destination component lane: '+name);
  assert.equal(found[0].status,'completed','Destination component lane not completed: '+name);
  assert.equal(found[0].conclusion,'success','Destination component lane not successful: '+name);
 }
 return {qualified:true,runId:run.id,attempt:run.run_attempt,sourceSha:run.head_sha,planDigest:plan.digest,url:run.html_url,repository:DEST_REPOSITORY,workflow:DEST_WORKFLOW};
}
async function parent(){const receipt=await(await get('release-qualified.json')).json();assert.equal(receiptDigest(receipt),PARENT,'Production receipt changed');return receipt;}
export function patchManifest(prior){return {schema:1,kind:'poweramp-shuffle-patch',baseArtifactDigest:prior.frontendArtifactDigest,source:SOURCE,files:FILES.map(({path,sha256,bytes,before})=>({path,sha256,bytes,
 // Smallest release scope (Lucy seq-232): a file whose pin already equals its
 // required live bytes is never uploaded; the receipt records that it was left
 // untouched. Any other file is uploaded.
 status:before===sha256?'skipped-untouched':'uploaded'}))};}
export function checkedShuffleReceipt(receipt,expectedParent=PARENT){
 const p=receipt.shufflePatch,prior=p?.parentReceipt;assert.equal(receiptDigest(prior),expectedParent);
 assert.deepEqual(Object.keys(p).sort(),['artifact','kind','parentReceipt','sourceProof']);assert.equal(p.kind,'poweramp-shuffle');
 assert.equal(p.sourceProof.qualified,true);assert.equal(p.sourceProof.sourceSha,SOURCE);assert.deepEqual(p.artifact,patchManifest(prior));
 const w=receipt.workerCheckpoint;assert.equal(w.backendReusable,false);assert.equal(w.acceptedRun,WORKER_CHECKPOINT.acceptedRun);assert.equal(w.evidenceRun,WORKER_CHECKPOINT.evidenceRun);assert.equal(w.version,WORKER_CHECKPOINT.version);assert.equal(w.settingsDigest,WORKER_CHECKPOINT.settingsDigest);
 assert.match(receipt.orchestration,/^[a-f0-9]{40}$/);assert.match(receipt.runId,/^[1-9][0-9]*$/);assert.match(receipt.attempt,/^[1-9][0-9]*$/);
 assert.equal(canonicalDigest(receipt),canonicalDigest({...prior,orchestration:receipt.orchestration,runId:receipt.runId,attempt:receipt.attempt,frontendArtifactDigest:receiptDigest(p.artifact),shufflePatch:p,workerCheckpoint:receipt.workerCheckpoint}));return prior;
}
// Byte-qualification of the exact upload bytes (seq-182). The destination
// component lanes qualify the release-pinned tree (c28c1b2f...), not these
// bytes: no CI run executes jarvis/public/drawercast/player.js at SOURCE, so
// the publisher qualifies the exact bytes itself, on the SOURCE checkout,
// before any upload. Each JavaScript file must parse, and the player must
// carry the reviewed PR #258 acceptance markers (each verified present
// in the new bytes and absent in the old). Font files must carry the woff
// magic; the rewritten index.html must reference the fingerprinted assets,
// carry no inline font data, and preserve the live CSP meta. This establishes
// the uploaded bytes are syntactically valid and carry the reviewed feature
// set; behavioral qualification remains the live-verification step. Fail-closed.
const PLAYER_MARKERS=['Waiting for connection','If-None-Match','auto-resume-armed','play-start-retry','R2 library not modified'];
const isPlayerPath=p=>/^drawercast\/player\.[0-9a-f]{12}\.js$/.test(p);
export function qualifyUploadBytes(files){
 const playerFile=files.find(f=>isPlayerPath(f.path));
 for(const file of files){
  const bytes=readFileSync(file.absPath);
  if(file.path.endsWith('.js')){
   execFileSync(process.execPath,['--check',file.absPath],{stdio:'pipe'});
   if(isPlayerPath(file.path)){
    const text=bytes.toString('utf8');
    for(const marker of PLAYER_MARKERS)
     assert.ok(text.includes(marker),'Upload bytes missing reviewed acceptance marker '+marker+' in '+file.path);
   }
  }else if(file.path.endsWith('.woff')){
   assert.equal(bytes.subarray(0,4).toString('ascii'),'wOFF','Invalid woff magic in '+file.path);
  }else if(file.path==='drawercast/index.html'){
   const text=bytes.toString('utf8');
   assert.ok(text.includes('Content-Security-Policy'),'Rewritten index.html dropped the CSP meta');
   assert.ok(!text.includes('base64'),'Rewritten index.html still carries inline font data');
   assert.ok(playerFile&&text.includes('./'+playerFile.path.split('/').pop()),'Rewritten index.html does not reference the fingerprinted player');
   for(const f of files){
    const m=f.path.match(/^drawercast\/fonts\/(.+)\.[0-9a-f]{12}\.woff$/);
    if(m) assert.ok(text.includes('./fonts/'+f.path.split('/').pop()),'Rewritten index.html missing fingerprinted font '+f.path);
   }
  }
 }
 return files.length;
}
async function source(){
 assert.equal(git(ROOT,'rev-parse','HEAD'),SOURCE);immutableSourceSnapshot(ROOT);assert.ok(recipeAllowed(JARVIS,SHUFFLE_RECIPE));
 const plan=await destinationPlan();
 const proof=await findDestinationProof(SOURCE,plan);assert.equal(proof.qualified,true,'Exact trusted source proof required');
 // Fingerprinted live paths are derived deterministically from the exact
 // source bytes; the pins file is the reviewed snapshot and must match the
 // derivation, otherwise the publish stops here.
 const fp=await expectedFingerprints();
 const expectedPaths=new Set(['drawercast/shuffle-worker.js','drawercast/index.html',...Object.values(fp)]);
 assert.deepEqual(new Set(FILES.map(f=>f.path)),expectedPaths,'FILES do not match the fingerprinted source derivation');
 for(const file of FILES){
  const logical=file.logical||file.path;
  if(fp[logical]) assert.equal(file.path,fp[logical],'Fingerprinted path does not match source bytes for '+logical);
  const {bytes,contentType}=await uploadBytes(file);
  assert.equal(hash(bytes),file.sha256,'Upload bytes hash mismatch for '+file.path);
  assert.equal(bytes.length,file.bytes,'Upload bytes size mismatch for '+file.path);
  if(file.contentType) assert.equal(contentType,file.contentType,'Content type mismatch for '+file.path);
 }
 // qualifyUploadBytes runs against the exact upload bytes (the rewritten
 // index.html, not the source template), staged to temp files.
 const dir=await mkdtemp(join(tmpdir(),'shuffle-upload-bytes-'));
 try{
  const staged=[];
  for(const file of FILES){
   const {bytes}=await uploadBytes(file);
   const absPath=resolve(dir,file.path.replace(/\//g,'_'));
   await writeFile(absPath,bytes);staged.push({path:file.path,absPath});
  }
  qualifyUploadBytes(staged);
 }finally{await rm(dir,{recursive:true,force:true});}
 // The focused Phase 1+2 behavior suite executes the exact upload bytes in a
 // VM harness and must pass before any upload. It asserts the reviewed pins
 // itself, so it cannot pass against substituted bytes.
 try{
  execFileSync(process.execPath,['--test',fileURLToPath(new URL('./drawercast-phase12-qualification.mjs',import.meta.url))],
   {env:{...process.env,POWERAMP_SOURCE_ROOT:ROOT},stdio:'pipe',timeout:180000});
 }catch(e){
  assert.fail('Phase 1+2 behavior qualification failed for the exact upload bytes:\n'+String((e.stdout||'')+(e.stderr||'')).slice(-4000));
 }
 return proof;
}
const az=args=>execFileSync('az',['storage','blob',...args,'--account-name','missionarytube','--auth-mode','login','--container-name','$web','--only-show-errors'],{encoding:'utf8',stdio:'pipe',maxBuffer:8*1024*1024});
function inventory(){const rows=JSON.parse(az(['list','--query','[].{name:name,etag:properties.etag,size:properties.contentLength}','--output','json']));assert.ok(Array.isArray(rows)&&rows.length<5000,'Complete small blob inventory required');return rows.sort((a,b)=>a.name.localeCompare(b.name));}
export function unchangedInventory(before,after){
 const filePaths=new Set(FILES.map(f=>f.path));
 const omitted=new Set([...filePaths,'release-qualified.json']);
 // Superseded fingerprinted blobs (old player/font versions, the legacy
 // unhashed player.js) are removed by publish() after the new files verify;
 // they are expected absent, not "unrelated changes".
 const beforeKept=before.filter(f=>!omitted.has(f.name)&&!isSupersededAsset(f.name,filePaths));
 assert.deepEqual(after.filter(f=>!omitted.has(f.name)),beforeKept,'An unrelated blob changed');
 const expected=new Set(before.map(f=>f.name));
 for(const f of FILES) if(f.before===null) expected.add(f.path);
 for(const b of before) if(isSupersededAsset(b.name,filePaths)) expected.delete(b.name);
 assert.deepEqual(after.map(f=>f.name),[...expected].sort((a,b)=>a.localeCompare(b)),'Blob inventory changed');
}
async function retryRead(operation){for(let attempt=0;;attempt++){try{return await operation()}catch(error){if(attempt===2||error.code==='ERR_ASSERTION')throw error;await new Promise(resolve=>setTimeout(resolve,2000));}}}
async function worker(){assert.match(WORKER_CHECKPOINT.version,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);assert.match(WORKER_CHECKPOINT.settingsDigest,/^[a-f0-9]{64}$/);assert.deepEqual(await retryRead(()=>liveIdentity({account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN})),{version:WORKER_CHECKPOINT.version,settingsDigest:WORKER_CHECKPOINT.settingsDigest});}
async function verifyFiles(){
 for(const file of FILES){
  const r=await get(file.path);
  assert.equal(hash(Buffer.from(await r.arrayBuffer())),file.sha256,'Live hash mismatch for '+file.path);
  const cc=r.headers.get('cache-control')||'';
  // Fingerprinted assets are immutable forever (the name is the version);
  // the entry point and the pinned worker stay revalidating.
  if(file.cache==='immutable') assert.match(cc,/immutable/,'Live file missing immutable cache-control: '+file.path);
  else assert.match(cc,/no-cache|no-store/,'Live file missing no-cache: '+file.path);
 }
}
async function existingFile(file){
 const r=await fetch(ORIGIN+'/'+file.path,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(file.before===null){assert.equal(r.status,404,'New shuffle worker must be absent');return null;}
 assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(hash(bytes),file.before,'Unexpected existing Poweramp bytes');return bytes;
}
// Smallest release scope (Lucy seq-232): when the pin already equals the
// required live bytes, the blob must be left untouched. The exact hash AND
// byte size are verified as a required dependency before skipping; any
// mismatch fails closed. Returns 'skipped-untouched'.
export function verifyUntouchedLive(file,liveBytes){
 assert.equal(file.before,file.sha256,'Untouched skip requires before==sha256 for '+file.path);
 assert.ok(liveBytes,'Live bytes required for '+file.path);
 assert.equal(liveBytes.length,file.bytes,'Live byte size mismatch for '+file.path);
 assert.equal(hash(liveBytes),file.sha256,'Live hash mismatch for '+file.path);
 return 'skipped-untouched';
}
async function main(command){
 assert.ok(['prepare','publish','record','stamp','published'].includes(command));
 if(command==='prepare'){
  const proof=await source(),prior=await parent();await mkdir('poweramp-publication/before/drawercast',{recursive:true});
  for(const file of FILES){const bytes=await existingFile(file);if(bytes)await writeFile('poweramp-publication/before/'+file.path,bytes);}
  await writeFile('poweramp-publication/plan.json',JSON.stringify({source:SOURCE,proof,parent:prior,files:FILES},null,2)+'\n');
  console.log(JSON.stringify({source:SOURCE,proofRun:proof.runId,files:FILES.map(f=>f.path),workerDeployed:false}));return;
 }
 const plan=await local('poweramp-publication/plan.json');assert.equal(receiptDigest(plan.parent),PARENT);assert.deepEqual(plan.files,FILES);await source();await worker();
 if(command==='publish'){
  await parent();const before=inventory();await writeFile('poweramp-publication/storage-before.json',JSON.stringify(before,null,2)+'\n');
  const filePaths=new Set(FILES.map(f=>f.path));
  // Stage the exact upload bytes (the rewritten index.html lives only here).
  const stage=await mkdtemp(join(tmpdir(),'shuffle-publish-'));
  try{
   // Dependency order: worker (skipped), player, fonts, entry point last.
   // index.html references the fingerprinted names, so it must land after
   // the assets it points to. Cleanup of superseded blobs happens only
   // after every new file verifies live.
   for(const file of FILES){
    await parent();const live=await existingFile(file);
    if(file.before===file.sha256){
     // Smallest release scope (Lucy seq-232): the live bytes are required to
     // equal the pin, so uploading would be a no-op. Verify hash+size as a
     // required gate, then leave the blob untouched — never upload it.
     verifyUntouchedLive(file,live);
     console.log(JSON.stringify({skippedUntouched:file.path}));continue;
    }
    const {bytes,contentType}=await uploadBytes(file);
    const staged=resolve(stage,file.path.replace(/\//g,'_'));await writeFile(staged,bytes);
    const cacheControl=file.cache==='immutable'?CACHE_IMMUTABLE:'no-cache';
    az(['upload','--name',file.path,'--file',staged,'--content-type',contentType,'--content-cache-control',cacheControl,'--overwrite','true']);
    assert.equal(hash(Buffer.from(await(await get(file.path)).arrayBuffer())),file.sha256,'Uploaded bytes mismatch for '+file.path);
    console.log(JSON.stringify({uploaded:file.path,cacheControl,contentType}));
   }
   // Remove superseded fingerprinted blobs (old player/font versions and the
   // legacy unhashed player.js) so immutable caching never accumulates stale
   // versions. Only blobs matching managed-asset patterns and absent from
   // FILES are touched; anything else fails the inventory guard below.
   const superseded=before.map(f=>f.name).filter(name=>isSupersededAsset(name,filePaths));
   for(const name of superseded){
    az(['delete','--name',name]);
    console.log(JSON.stringify({deletedSuperseded:name}));
   }
  }finally{await rm(stage,{recursive:true,force:true});}
  await verifyFiles();unchangedInventory(before,inventory());await worker();
 }else if(command==='record'){
  await parent();await verifyFiles();unchangedInventory(await local('poweramp-publication/storage-before.json'),inventory());
  const artifact=patchManifest(plan.parent),receipt={...plan.parent,orchestration:git(process.cwd(),'rev-parse','HEAD'),runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,frontendArtifactDigest:receiptDigest(artifact),shufflePatch:{kind:'poweramp-shuffle',parentReceipt:plan.parent,sourceProof:plan.proof,artifact},workerCheckpoint:{version:WORKER_CHECKPOINT.version,settingsDigest:WORKER_CHECKPOINT.settingsDigest,acceptedRun:WORKER_CHECKPOINT.acceptedRun,evidenceRun:WORKER_CHECKPOINT.evidenceRun,backendReusable:false}};
  checkedShuffleReceipt(receipt);await writeFile('release-qualified.json',JSON.stringify(receipt,null,2)+'\n');await appendFile(process.env.GITHUB_OUTPUT,'digest='+receiptDigest(receipt)+'\n');
  console.log(JSON.stringify({source:SOURCE,receiptDigest:receiptDigest(receipt),workerUnchanged:true,settingsUnchanged:true,unrelatedBlobsUnchanged:true}));
 }else{
  const receipt=await local('release-qualified.json');checkedShuffleReceipt(receipt);assert.equal(receiptDigest(receipt),process.env.EXPECTED_RECEIPT_DIGEST);
  await verifyFiles();unchangedInventory(await local('poweramp-publication/storage-before.json'),inventory());
  assert.equal(receiptDigest(await(await get('release-qualified.json')).json()),command==='published'?receiptDigest(receipt):PARENT);
  console.log(JSON.stringify({operation:command,verified:true,source:SOURCE,workerUnchanged:true,settingsUnchanged:true}));
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv[2]).catch(e=>{console.error('Poweramp shuffle publication stopped: '+(e.code==='ERR_ASSERTION'?e.message.split('\n')[0]:'provider_or_validation_failed'));process.exitCode=1;});
