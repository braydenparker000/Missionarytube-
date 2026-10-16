// Frontend-only publication. No Worker upload, configuration write or new access.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,dirname,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
const ROOT=resolve('.private-board-source'),STAGE=resolve('.private-board-stage'),OUT=resolve('private-board-publication');
const ORIGIN='https://missionarytube.z13.web.core.windows.net',RECEIPT='private-workspace-release.json';
const HASH=/^[a-f0-9]{64}$/,SHA=/^[a-f0-9]{40}$/;
export const hash=x=>createHash('sha256').update(x).digest('hex');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const git=(...args)=>execFileSync('git',['-C',ROOT,...args],{encoding:'utf8',stdio:'pipe'}).trim();
export function checkedPins(p){
 assert.equal(p.schema,1);assert.equal(p.ready,true,'Final reviewed pins required');assert.match(p.source,SHA);assert.match(p.parentReceiptSha256,HASH);
 assert.ok(p.worker);assert.match(p.worker.version,/^[a-f0-9-]{36}$/);
 assert.deepEqual(Object.keys(p.worker).sort(),['codeSha256','schedulesDigest','settingsDigest','version']);
 for(const k of ['codeSha256','settingsDigest','schedulesDigest'])assert.match(p.worker[k],HASH);
 assert.deepEqual(Object.keys(p.recipe).sort(),['.github/workflows/validate-r2.yml','scripts/install-qualification-browser.mjs','scripts/qualification-proof.mjs','tests/helpers/ci-test-inventory.mjs'].sort());
 for(const v of Object.values(p.recipe))assert.match(v,SHA);
 assert.ok(Array.isArray(p.files)&&p.files.length>0&&p.files.length<40);assert.ok(Array.isArray(p.dependencies)&&p.dependencies.length<100);
 const paths=[...p.files,...p.dependencies].map(f=>f.path);assert.equal(new Set(paths).size,paths.length);
 for(const f of p.files){assert.match(f.path,/^(private\/[a-z]+\.html|assets\/(?:hub|relay-owner-api|private-[a-z-]+)\.(?:js|css))$/);assert.match(f.sha256,HASH);assert.ok(f.before===null||HASH.test(f.before));assert.ok(Number.isSafeInteger(f.bytes)&&f.bytes>0);}
 for(const f of p.dependencies){assert.match(f.path,/^(?:assets|private)\/[a-zA-Z0-9_-]+\.(?:html|js|css)$/);assert.match(f.sha256,HASH);}
 return p;
}
export function checkedExisting(bytes,file,allowPublished=false){const digest=bytes===null?null:hash(bytes);assert.ok(digest===file.before||(allowPublished&&digest===file.sha256),'Live baseline changed: '+file.path);}
export function unchangedInventory(before,after,p){
 const allowed=new Set([...p.files.map(f=>f.path),RECEIPT]);
 assert.deepEqual(after.filter(f=>!allowed.has(f.name)),before.filter(f=>!allowed.has(f.name)),'Unrelated static file changed');
 assert.deepEqual(after.map(f=>f.name).sort(),[...new Set([...before.map(f=>f.name),...p.files.map(f=>f.path),RECEIPT])].sort(),'Unexpected blob inventory');
}
// Dependencies first; importing controllers next; entry HTML last.
export function orderedFiles(files){const rank=f=>f.path.endsWith('.html')?3:['assets/private-workspace.js','assets/private-collaboration.js','assets/hub.js'].includes(f.path)?2:1;return [...files].sort((a,b)=>rank(a)-rank(b)||a.path.localeCompare(b.path));}
async function live(path){const r=await fetch(ORIGIN+'/'+path,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});if(r.status===404)return null;assert.equal(r.status,200,'Static GET failed');return Buffer.from(await r.arrayBuffer());}
async function parent(p){const bytes=await live(RECEIPT);assert.ok(bytes);assert.equal(hash(bytes),p.parentReceiptSha256,'Production receipt changed');return bytes;}
async function dependencies(p){for(const f of p.dependencies){const bytes=await live(f.path);assert.ok(bytes);assert.equal(hash(bytes),f.sha256,'Live dependency changed: '+f.path);}}
async function source(p){
 assert.equal(git('rev-parse','HEAD'),p.source);
 assert.equal(git('status','--porcelain','--untracked-files=no'),'','Tracked source changed');
 for(const [path,sha] of Object.entries(p.recipe)){assert.equal(git('rev-parse','HEAD:'+path),sha);const bytes=await readFile(resolve(ROOT,path));assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),sha);}
 const q=await import(pathToFileURL(resolve(ROOT,'scripts/qualification-proof.mjs')));
 const plan=q.makePlan(q.localEntries(ROOT),q.declaredEnvironment(ROOT,{QUALIFICATION_NODE22:'v22.23.3',QUALIFICATION_NODE24:'v24.21.0',QUALIFICATION_PYTHON:'Python 3.12.15'}));
 const proof=await q.findProof(plan,{sourceSha:p.source});assert.equal(proof.qualified,true,'Exact trusted-push qualification required');
 for(const f of p.files){const bytes=await readFile(resolve(ROOT,'public',f.path));assert.equal(hash(bytes),f.sha256);assert.equal(bytes.length,f.bytes);}
 return proof;
}
async function worker(p){
 // Existing helper performs bounded GETs only; never call its deploy/publish functions.
 const {observe}=await import('./publish-private-collaboration.mjs');
 const result=await observe({account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN});
 assert.deepEqual(result.identity,p.worker,'Parent-deployed Worker changed');return result.identity;
}
const az=args=>execFileSync('az',['storage','blob',...args,'--account-name','missionarytube','--auth-mode','login','--container-name','$web','--only-show-errors'],{encoding:'utf8',stdio:'pipe',maxBuffer:8*1024*1024});
function inventory(){const rows=JSON.parse(az(['list','--query','[].{name:name,etag:properties.etag,size:properties.contentLength}','--output','json']));assert.ok(Array.isArray(rows)&&rows.length<5000);assert.equal(new Set(rows.map(r=>r.name)).size,rows.length);return rows.sort((a,b)=>a.name.localeCompare(b.name));}
async function verifiedFiles(p){for(const f of p.files){const r=await fetch(ORIGIN+'/'+f.path,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);assert.equal(hash(Buffer.from(await r.arrayBuffer())),f.sha256);assert.match(r.headers.get('cache-control')||'',/no-cache|no-store/);const type=r.headers.get('content-type')||'';assert.ok(type.startsWith(mime[extname(f.path)].split(';')[0]),'Unexpected MIME');}}
async function main(mode){
 assert.ok(['prepare','publish','verify'].includes(mode));const p=checkedPins(await json('scripts/private-board-pins.json'));const proof=await source(p);await mkdir(OUT,{recursive:true});
 if(mode==='prepare'){
  await parent(p);await dependencies(p);await cp(resolve(ROOT,'public'),STAGE,{recursive:true});
  for(const f of p.files){const bytes=await live(f.path);checkedExisting(bytes,f);if(bytes){const path=resolve(OUT,'before',f.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);}}
  for(const f of p.dependencies){const bytes=await live(f.path);assert.equal(hash(bytes),f.sha256);const path=resolve(STAGE,f.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);}
  await writeFile(resolve(OUT,'plan.json'),JSON.stringify({pins:p,proof},null,2)+'\n');return;
 }
 const plan=await json(resolve(OUT,'plan.json'));assert.deepEqual(plan.pins,p);assert.deepEqual(plan.proof,proof);await worker(p);await dependencies(p);
 if(mode==='publish'){
  await parent(p);const before=inventory();await writeFile(resolve(OUT,'storage-before.json'),JSON.stringify(before,null,2)+'\n');
  // A failed/uncertain write stops. Resume requires inspected live bytes and a new reviewed plan.
  for(const f of orderedFiles(p.files)){await parent(p);await worker(p);checkedExisting(await live(f.path),f);const path=resolve(STAGE,f.path);assert.equal(hash(await readFile(path)),f.sha256);az(['upload','--name',f.path,'--file',path,'--content-type',mime[extname(f.path)],'--content-cache-control','no-cache','--overwrite','true']);assert.equal(hash(await live(f.path)),f.sha256);}
  await verifiedFiles(p);await dependencies(p);await worker(p);unchangedInventory(before,inventory(),p);await parent(p);
  const receipt={schema:1,kind:'private-board-static-patch',source:p.source,orchestration:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,proof,files:p.files,dependencies:p.dependencies,parentReceiptSha256:p.parentReceiptSha256,backend:p.worker,workerChanged:false,authorizationChanged:false,verifiedAt:new Date().toISOString()};
  const path=resolve(OUT,RECEIPT);await writeFile(path,JSON.stringify(receipt,null,2)+'\n');az(['upload','--name',RECEIPT,'--file',path,'--content-type','application/json','--content-cache-control','no-cache','--overwrite','true']);
 }
 await verifiedFiles(p);await dependencies(p);await worker(p);unchangedInventory(await json(resolve(OUT,'storage-before.json')),inventory(),p);assert.equal(hash(await live(RECEIPT)),hash(await readFile(resolve(OUT,RECEIPT))));
 console.log('Verified exact static board bytes; Worker and unrelated blobs unchanged');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv[2]).catch(()=>{console.error('Static board publication stopped. Inspect checkpoint and live state before retry; provider bodies are not logged.');process.exitCode=1;});
