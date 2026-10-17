// Guarded, component-only publication for the additive Daily Board importer.
// This candidate does not configure a destination issue or enable its reader.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {observe,publishWorker} from './publish-private-collaboration.mjs';
import {fullSettingsDigest} from './saving-worker-reconciliation.mjs';
import {settingsDigest} from './worker-release-identity.mjs';

export const SOURCE='62ac633f367250ed21b3ecf7a4627263e9e07d9f';
export const BASELINE=Object.freeze({version:'aaf9612a-dc41-4904-bd90-887b4f8f9f7c',
  codeSha256:'642af5986b00aaa9d059204668dc0e1351cd0d0dbeee19f3b577c4a0a68232e8',
  settingsDigest:'e2a1add50b4ec89596fdb1409d5335b3e1357229c07071a730dd637cf32dc089',
  settingsShapeDigest:'b3f90280b3fa8d60be3b75202e223336eeba79f2f1abb52b27e7dc191e6c0d4c',
  schedulesDigest:'6daa9ec137a94fc5962f6d05ab16df8dba70096ae34571ccd552ac130cd733c5'});
export const CANDIDATE=Object.freeze({workerSha256:'74c8bf880a674b19bfeab74f65cf87e069b9f88233c4e65eba37393b13d0064d',
  workerBytes:661389,importerSha256:'9397e2e3731368e5d5a51e865f2cfd45c33fae992dcdaae2dfa4c879b7deeed8',
  cacheSha256:'a61ad5a113bf1fb1e048d2dd1d8a3b99a7acc132ac3723161fefa6f419672b95',
  cacheBytes:10193,cacheBeforeSha256:'ed2f6710658c940c708f34ac748e572065df2ed7183e6e6401f81d2764404aa9'});
const OUT=resolve('publications-import-publication');
const sha=b=>createHash('sha256').update(b).digest('hex');
const git=(...args)=>execFileSync('git',['-C','.daily-board-import-source',...args],{encoding:'utf8',stdio:'pipe'}).trim();
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const credentials=()=>({account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN});
const cachePath=resolve('jarvis/public/assets/public-reader-cache.js');
const sourcePath=resolve('.daily-board-import-source');

function noDestinationActivation(settings){
 const names=new Set(settings.bindings.map(b=>b.name));
 assert.equal(names.has('JARVIS_DAILY_BOARD_DESTINATION_ENABLED'),false,'Destination importer flag must remain absent');
 assert.equal(names.has('JARVIS_DAILY_BOARD_DESTINATION_ISSUE'),false,'Destination issue binding must remain absent');
 assert.equal(new Set(settings.bindings.map(b=>b.name)).size,settings.bindings.length,'Duplicate binding names');
}
export function checkedBaseline(identity){
 for(const key of ['version','codeSha256','settingsDigest','schedulesDigest'])assert.equal(identity[key],BASELINE[key],'Live Worker '+key+' changed');
 return identity;
}
async function compile(){
 assert.equal(git('rev-parse','HEAD'),SOURCE,'Worker source revision changed');
 const importer=await readFile('jarvis/backend/publications.js');
 assert.equal(sha(importer),CANDIDATE.importerSha256,'Imported publications source changed');
 const cache=await readFile(cachePath);
 assert.equal(cache.length,CANDIDATE.cacheBytes);assert.equal(sha(cache),CANDIDATE.cacheSha256,'Cache candidate changed');
 const {build}=await import(pathToFileURL(resolve(sourcePath,'node_modules/esbuild/lib/main.js')).href);
 const compileOne=async()=>{const r=await build({absWorkingDir:sourcePath,entryPoints:['backend/worker.js'],bundle:true,write:false,
   platform:'browser',format:'esm',target:'es2022',external:['cloudflare:workers','node:*'],logLevel:'silent'});
   assert.equal(r.outputFiles.length,1);return Buffer.from(r.outputFiles[0].contents);};
 const active=await compileOne();assert.equal(sha(active),BASELINE.codeSha256,'Source no longer reproduces exact live Worker bytes');
 const sourceImporter=execFileSync('git',['-C',sourcePath,'show','HEAD:backend/publications.js'],{encoding:'buffer',stdio:'pipe'});
 let worker;
 try{await writeFile(resolve(sourcePath,'backend/publications.js'),importer);worker=await compileOne();}
 finally{await writeFile(resolve(sourcePath,'backend/publications.js'),sourceImporter);}
 assert.equal(worker.length,CANDIDATE.workerBytes);assert.equal(sha(worker),CANDIDATE.workerSha256,'Candidate Worker bytes changed');
 assert.equal(git('status','--porcelain','--untracked-files=no'),'','Temporary source overlay was not restored');
 await mkdir(OUT,{recursive:true});await writeFile(resolve(OUT,'worker-candidate.js'),worker);await writeFile(resolve(OUT,'public-reader-cache.js'),cache);
 const manifest={schema:1,repository:'braydenparker000/Missionarytube-',source:SOURCE,
   overlay:{path:'jarvis/backend/publications.js',sha256:CANDIDATE.importerSha256},
   build:{esbuild:'0.25.10',entry:'backend/worker.js',platform:'browser',format:'esm',target:'es2022',external:['cloudflare:workers','node:*']},
   baseline:BASELINE,candidate:{workerSha256:CANDIDATE.workerSha256,workerBytes:CANDIDATE.workerBytes,
     staticPath:'assets/public-reader-cache.js',staticBeforeSha256:CANDIDATE.cacheBeforeSha256,
     staticSha256:CANDIDATE.cacheSha256,staticBytes:CANDIDATE.cacheBytes},destinationActivation:'disabled; no destination issue configured'};
 await writeFile(resolve(OUT,'candidate.json'),JSON.stringify(manifest,null,2)+'\n');
 return manifest;
}
async function workerBytes(fetcher=fetch){
 const {account,token}=credentials();const r=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/content/v2`,
  {method:'GET',redirect:'error',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200,'Worker rollback bytes unavailable');const entries=[...(await r.formData()).entries()].filter(([,v])=>typeof v!=='string');
 assert.equal(entries.length,1);assert.equal(entries[0][0],'worker.js');return Buffer.from(await entries[0][1].arrayBuffer());
}
function az(args){return execFileSync('az',args,{encoding:'utf8',stdio:'pipe',timeout:60000});}
async function cacheBytes(name='cache-live.js'){
 az(['storage','blob','download','--account-name','missionarytube','--auth-mode','login','--container-name','$web',
   '--name','assets/public-reader-cache.js','--file',resolve(OUT,name),'--overwrite','true','--only-show-errors']);
 return readFile(resolve(OUT,name));
}
async function preflight(){
 const manifest=await compile();const current=await observe(credentials());checkedBaseline(current.identity);noDestinationActivation(current.settings);
 assert.equal(fullSettingsDigest(current.settings),BASELINE.settingsDigest);
 assert.equal(settingsDigest(current.settings),BASELINE.settingsShapeDigest,'Worker binding values or shape changed');
 const oldWorker=await workerBytes();assert.equal(sha(oldWorker),BASELINE.codeSha256);
 const oldCache=await cacheBytes();assert.equal(sha(oldCache),CANDIDATE.cacheBeforeSha256,'Live static cache changed');
 await writeFile(resolve(OUT,'worker-before.js'),oldWorker);
 const checkpoint={schema:1,candidateSha256:sha(Buffer.from(JSON.stringify(manifest))),before:current.identity,
   workerRollbackSha256:sha(oldWorker),cacheRollbackSha256:sha(oldCache),rollback:{worker:'worker-before.js',cache:'cache-before.js'}};
 await writeFile(resolve(OUT,'checkpoint.json'),JSON.stringify(checkpoint,null,2)+'\n');
 console.log(JSON.stringify({preflight:true,workerBefore:checkpoint.before.codeSha256,cacheBefore:checkpoint.cacheRollbackSha256,
   rollbackFiles:['worker-before.js','cache-before.js'],settingsUnchanged:true,destinationActivation:false}));
}
async function publish(){
 const manifest=await compile(),checkpoint=await json(resolve(OUT,'checkpoint.json'));
 assert.equal(checkpoint.candidateSha256,sha(Buffer.from(JSON.stringify(manifest))),'Candidate differs from backed-up plan');
 const {account,token}=credentials(),current=await observe({account,token});checkedBaseline(current.identity);noDestinationActivation(current.settings);
 assert.deepEqual(current.identity,checkpoint.before,'Worker changed after rollback capture');
 const oldCache=await readFile(resolve(OUT,'cache-before.js'));assert.equal(sha(oldCache),checkpoint.cacheRollbackSha256);
 const worker=await readFile(resolve(OUT,'worker-candidate.js'));assert.equal(sha(worker),CANDIDATE.workerSha256);
 const cache=await readFile(resolve(OUT,'public-reader-cache.js'));assert.equal(sha(cache),CANDIDATE.cacheSha256);
 const afterWorker=await publishWorker({account,token,bundle:worker,before:checkpoint.before});
 assert.equal(afterWorker.codeSha256,CANDIDATE.workerSha256);assert.equal(afterWorker.settingsDigest,checkpoint.before.settingsDigest);
 assert.equal(afterWorker.schedulesDigest,checkpoint.before.schedulesDigest);
 az(['storage','blob','upload','--account-name','missionarytube','--auth-mode','login','--container-name','$web',
   '--name','assets/public-reader-cache.js','--file',resolve(OUT,'public-reader-cache.js'),'--content-type','application/javascript',
   '--content-cache-control','no-cache','--overwrite','true','--only-show-errors']);
 const liveCache=await cacheBytes();assert.equal(sha(liveCache),CANDIDATE.cacheSha256,'Static cache read-back mismatch');
 const final=(await observe({account,token})).identity;assert.equal(final.codeSha256,CANDIDATE.workerSha256);
 assert.equal(final.settingsDigest,checkpoint.before.settingsDigest);assert.equal(final.schedulesDigest,checkpoint.before.schedulesDigest);
 const receipt={schema:1,kind:'daily-board-import-candidate',source:SOURCE,manifest,candidateWorkerSha256:CANDIDATE.workerSha256,
   candidateCacheSha256:CANDIDATE.cacheSha256,before:checkpoint.before,after:final,settingsUnchanged:true,schedulesUnchanged:true,
   destinationActivation:false,rollbackArtifacts:checkpoint.rollback};
 await writeFile(resolve(OUT,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({published:true,workerSha256:final.codeSha256,cacheSha256:CANDIDATE.cacheSha256,
   settingsUnchanged:true,schedulesUnchanged:true,destinationActivation:false}));
}
async function rollback(){
 const checkpoint=await json(resolve(OUT,'checkpoint.json')),oldWorker=await readFile(resolve(OUT,'worker-before.js')),
   oldCache=await readFile(resolve(OUT,'cache-before.js'));
 assert.equal(checkpoint.schema,1);checkedBaseline(checkpoint.before);
 assert.equal(checkpoint.workerRollbackSha256,BASELINE.codeSha256);assert.equal(checkpoint.cacheRollbackSha256,CANDIDATE.cacheBeforeSha256);
 assert.equal(sha(oldWorker),BASELINE.codeSha256);assert.equal(sha(oldCache),CANDIDATE.cacheBeforeSha256);
 const {account,token}=credentials(),current=await observe({account,token});noDestinationActivation(current.settings);
 assert.equal(current.identity.codeSha256,CANDIDATE.workerSha256,'Refusing rollback over an unrecognized Worker');
 assert.equal(current.identity.settingsDigest,checkpoint.before.settingsDigest);assert.equal(current.identity.schedulesDigest,checkpoint.before.schedulesDigest);
 assert.equal(fullSettingsDigest(current.settings),BASELINE.settingsDigest);assert.equal(settingsDigest(current.settings),BASELINE.settingsShapeDigest);
 const liveCache=await cacheBytes();assert.equal(sha(liveCache),CANDIDATE.cacheSha256,'Refusing rollback over an unrecognized static asset');
 await publishWorker({account,token,bundle:oldWorker,before:current.identity});
 az(['storage','blob','upload','--account-name','missionarytube','--auth-mode','login','--container-name','$web',
   '--name','assets/public-reader-cache.js','--file',resolve(OUT,'cache-before.js'),'--content-type','application/javascript',
   '--content-cache-control','no-cache','--overwrite','true','--only-show-errors']);
 const restored=(await observe({account,token})).identity,restoredCache=await cacheBytes();
 assert.equal(restored.codeSha256,BASELINE.codeSha256);assert.equal(restored.settingsDigest,checkpoint.before.settingsDigest);
 assert.equal(restored.schedulesDigest,checkpoint.before.schedulesDigest);assert.equal(sha(restoredCache),CANDIDATE.cacheBeforeSha256);
 console.log(JSON.stringify({rolledBack:true,workerSha256:restored.codeSha256,cacheSha256:sha(restoredCache),settingsUnchanged:true,schedulesUnchanged:true}));
}
async function main(mode){assert.ok(['prepare','preflight','publish','rollback'].includes(mode));await mkdir(OUT,{recursive:true});
 if(mode==='prepare'){await compile();return;}if(mode==='preflight'){await preflight();return;}
 if(mode==='publish'){await publish();return;}await rollback();}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv[2]).catch(error=>{
 console.error('Daily Board candidate stopped at a guarded step; inspect checkpoint and provider state before any retry.');
 if(process.env.PUBLICATIONS_IMPORT_DEBUG==='1')console.error(String(error.message||error).split('\n')[0]);process.exitCode=1;
});
