// Static-only Daily Board publication using existing Azure federation.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readDailyBoardSource} from './media-source.mjs';
export const BEFORE='68aafa41562628ad87a93557ff5ab5afeecba83874b2b4abe142b953fd4b9454';
export const PATHS=['daily-board/v1/design.css','daily-board/v1/components.css','daily-board/v1/schema.js','daily-board/v1/render.js','daily-board/v1/live.js','daily-board/index.html'];
const OUT='daily-board-publication',ORIGIN='https://missionarytube.z13.web.core.windows.net';
export const sha=b=>createHash('sha256').update(b).digest('hex');
const az=args=>execFileSync('az',['storage','blob',...args,'--account-name','missionarytube','--auth-mode','login','--container-name','$web','--only-show-errors'],{encoding:'utf8',stdio:'pipe',timeout:60000});
const mime=path=>path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':'application/javascript; charset=utf-8';
export function guardSnapshot(expected,current){assert.equal(current.exists,expected.exists,'Blob existence changed');if(expected.exists){assert.equal(current.etag,expected.etag,'Blob ETag changed');assert.equal(current.hash,expected.hash,'Blob bytes changed');}}
export function publicationOrder(paths){assert.deepEqual([...paths].sort(),[...PATHS].sort());return PATHS;}
async function snapshot(path,name){
  const exists=JSON.parse(az(['exists','--name',path,'--output','json'])).exists;
  if(!exists)return {path,exists:false};
  const properties=JSON.parse(az(['show','--name',path,'--output','json'])).properties;
  const file=resolve(OUT,name);az(['download','--name',path,'--file',file,'--overwrite','true']);
  const bytes=await readFile(file),after=JSON.parse(az(['show','--name',path,'--output','json'])).properties;
  assert.equal(properties.etag,after.etag,'Blob changed during snapshot');
  assert.equal(bytes.length,after.contentLength);return {path,exists:true,etag:after.etag,hash:sha(bytes),properties:after,file:name};
}
async function candidate(){
 const source=readDailyBoardSource(),files=[];
 for(const path of PATHS){const data=await readFile('dist/'+path);files.push({path,hash:sha(data),bytes:data.length,type:mime(path)});}
 return {schema:1,source,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files};
}
async function prepare(){
 await mkdir(OUT,{recursive:true});const plan=await candidate();const before=[];
 for(const [i,file] of plan.files.entries())before.push(await snapshot(file.path,`before-${i}`));
 const route=before.at(-1);assert.equal(route.hash,BEFORE,'Daily Board route changed; review new baseline before publishing');
 // Versioned paths must be new or already exactly this candidate. Never replace an unknown dependency.
 for(const old of before.slice(0,-1))if(old.exists)assert.equal(old.hash,plan.files.find(f=>f.path===old.path).hash,'Versioned dependency already has different bytes');
 await writeFile(`${OUT}/checkpoint.json`,JSON.stringify({plan,before},null,2)+'\n');console.log('Captured exact static rollback bytes and ETags; no writes.');
}
async function publish(){
 const saved=JSON.parse(await readFile(`${OUT}/checkpoint.json`));assert.deepEqual(await candidate(),saved.plan,'Candidate changed after preflight');
 for(const [i,path] of publicationOrder(saved.plan.files.map(f=>f.path)).entries()){
   const expected=saved.before[i],file=saved.plan.files[i];
   guardSnapshot(expected,await snapshot(path,`check-${i}`));
   if(!expected.exists||expected.hash!==file.hash){
     az(['upload','--name',path,'--file',resolve('dist',path),'--content-type',file.type,'--content-cache-control','no-cache','--overwrite','true',...(expected.exists?['--if-match',expected.etag]:['--if-none-match','*'])]);
   }
   const after=await snapshot(path,`after-${i}`);assert.equal(after.hash,file.hash,'Blob readback mismatch');
   const response=await fetch(ORIGIN+'/'+path,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);assert.equal(sha(Buffer.from(await response.arrayBuffer())),file.hash,'Public readback mismatch');
 }
 const receipt={schema:1,commit:saved.plan.commit,source:saved.plan.source,files:saved.plan.files,runId:process.env.GITHUB_RUN_ID,workerChanged:false,databaseChanged:false,verifiedAt:new Date().toISOString()};
 await writeFile(`${OUT}/receipt.json`,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}
async function rollback(){
 const {plan,before}=JSON.parse(await readFile(`${OUT}/checkpoint.json`));const old=before.at(-1),file=plan.files.at(-1);
 assert.equal(old.path,'daily-board/index.html');assert.equal(old.hash,BEFORE);assert.equal(sha(await readFile(`${OUT}/${old.file}`)),BEFORE);
 const current=await snapshot(old.path,'rollback-current');assert.equal(current.hash,file.hash,'Current route is not this candidate');
 az(['upload','--name',old.path,'--file',resolve(OUT,old.file),'--content-type',old.properties.contentSettings.contentType,'--content-cache-control',old.properties.contentSettings.cacheControl||'no-cache','--overwrite','true','--if-match',current.etag]);
 assert.equal((await snapshot(old.path,'rollback-readback')).hash,BEFORE);console.log('Original route restored; all new assets and all reports retained.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const mode=process.argv[2];assert.ok(['prepare','publish','rollback'].includes(mode));await ({prepare,publish,rollback}[mode])();}
 catch{console.error('Daily Board publication stopped. Inspect retained checkpoint and provider state before retrying.');process.exitCode=1;}
}
