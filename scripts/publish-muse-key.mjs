import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {immutableSourceSnapshot,recipeAllowed} from './plan-jarvis-qualification.mjs';
export const SOURCE='833b97c4264c364dcce0789a6d64f938176a9057';
const ORIGIN='https://missionarytube.z13.web.core.windows.net',ROOT=resolve('.muse-source');
const RECEIPT='03c33d919658af489451e9b0997db6363a95bd5682463b5ff47308f3e4bc73c7';
const FILES=['key.css','key.js','index.html'];
const hash=value=>createHash('sha256').update(value).digest('hex');
const git=(...args)=>execFileSync('git',['-C',ROOT,...args],{encoding:'utf8'}).trim();
export function checkedDestination(name){assert.ok(FILES.includes(name));return 'muse-key/'+name;}
async function get(path){return fetch(ORIGIN+'/'+path,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});}
async function baseline(){
 const response=await get('release-qualified.json');assert.equal(response.status,200);const receipt=await response.json();
 assert.equal(hash(JSON.stringify(receipt)),RECEIPT,'Production receipt changed');
 const r=await get('release.json');assert.equal(r.status,200);const release=await r.json();
 assert.equal(release.commit,'363f710068bb6f2c456dbbf183f063484a36fe11');
 return {receiptDigest:RECEIPT,release:hash(JSON.stringify(release))};
}
async function source(){
 assert.equal(git('rev-parse','HEAD'),SOURCE);immutableSourceSnapshot(ROOT);assert.ok(recipeAllowed(ROOT));
 const q=await import(pathToFileURL(resolve(ROOT,'scripts/qualification-proof.mjs')));
 const env={QUALIFICATION_NODE22:'v22.23.3',QUALIFICATION_NODE24:'v24.21.0',QUALIFICATION_PYTHON:'Python 3.12.15'};
 const plan=q.makePlan(q.localEntries(ROOT),q.declaredEnvironment(ROOT,env));
 const proof=await q.findProof(plan,{sourceSha:SOURCE});assert.equal(proof.qualified,true,'Exact trusted-source qualification required');
 return proof;
}
async function main(command){
 assert.ok(['prepare','publish','verify'].includes(command));
 const proof=await source(),before=await baseline();
 const files=[];
 for(const name of FILES){
  const path=checkedDestination(name),data=await readFile(resolve(ROOT,'public',path));
  files.push({name,path,sha256:hash(data),bytes:data.length});
  if(name==='index.html'){
   assert.match(data.toString(),/http-equiv="Content-Security-Policy"/);
   assert.match(data.toString(),/connect-src 'none'/);
  }
 }
 if(command==='prepare'){
  await mkdir('muse-key-publication',{recursive:true});
  await writeFile('muse-key-publication/plan.json',JSON.stringify({source:SOURCE,proof,before,files},null,2)+'\n');
 }else{
  const saved=JSON.parse(await readFile('muse-key-publication/plan.json','utf8'));
  assert.deepEqual(saved.files,files);assert.deepEqual(saved.before,before);assert.equal(saved.source,SOURCE);
 }
 for(const file of files){
  let response=await get(file.path);
  if(response.status===404&&command==='publish'){
   const type=file.name.endsWith('.html')?'text/html; charset=utf-8':file.name.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8';
   execFileSync('az',['storage','blob','upload','--account-name','missionarytube','--auth-mode','login','--container-name','$web',
    '--name',file.path,'--file',resolve(ROOT,'public',file.path),'--content-type',type,'--content-cache-control','no-store','--overwrite','false','--only-show-errors'],{stdio:'pipe'});
   response=await get(file.path);
  }
  if(command==='prepare'&&response.status===404)continue;
  assert.equal(response.status,200);assert.equal(hash(Buffer.from(await response.arrayBuffer())),file.sha256,'Existing helper bytes differ; no overwrite permitted');
  assert.match(response.headers.get('cache-control')||'',/no-store/);
 }
 if(command!=='prepare'){
  const route=await get('muse-key/');assert.equal(route.status,200);assert.equal(hash(Buffer.from(await route.arrayBuffer())),files.find(f=>f.name==='index.html').sha256);
  assert.deepEqual(await baseline(),before);
  await writeFile('muse-key-publication/verified.json',JSON.stringify({source:SOURCE,proof,files,receiptDigest:RECEIPT,verified:true,credentialGenerated:false,workerDeployed:false,appOverwritten:false},null,2)+'\n');
 }
 console.log(JSON.stringify({operation:command,source:SOURCE,proofRun:proof.runId,files:files.length,credentialGenerated:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv[2]).catch(()=>{console.error('Bounded Muse helper publication stopped; no credential or unrelated publication is authorized.');process.exitCode=1;});
