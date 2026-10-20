// Restore retained historical importer backups only. Current code ships from backend/.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {observe,publishWorker} from './publish-private-collaboration.mjs';
import {fullSettingsDigest} from './saving-worker-reconciliation.mjs';
import {settingsDigest} from './worker-release-identity.mjs';

export const SOURCE='62ac633f367250ed21b3ecf7a4627263e9e07d9f';
export const BASELINE=Object.freeze({version:'484ad36b-1d9f-4679-ad1c-40fb47c99dd9',
  codeSha256:'642af5986b00aaa9d059204668dc0e1351cd0d0dbeee19f3b577c4a0a68232e8',workerBytes:645522,
  settingsDigest:'86d52aa1195c29495fe84aadaea05962a4730bbcc2067f49b720293198439e92',
  normalizedSettingsDigest:'e2a1add50b4ec89596fdb1409d5335b3e1357229c07071a730dd637cf32dc089',
  auditAnnotation:'upload',
  settingsShapeDigest:'b3f90280b3fa8d60be3b75202e223336eeba79f2f1abb52b27e7dc191e6c0d4c',
  schedulesDigest:'6daa9ec137a94fc5962f6d05ab16df8dba70096ae34571ccd552ac130cd733c5'});
export const CREATION_SETTINGS_DIGEST=BASELINE.normalizedSettingsDigest;
// The provider may retain `upload` or restore the original creation marker after an upload.
// Both raw digests are pinned; all other settings remain part of the normalized digest.
export const UPLOAD_SETTINGS_DIGEST=BASELINE.settingsDigest;
export const CANDIDATE=Object.freeze({workerSha256:'74c8bf880a674b19bfeab74f65cf87e069b9f88233c4e65eba37393b13d0064d',
  workerBytes:661389,importerSha256:'9397e2e3731368e5d5a51e865f2cfd45c33fae992dcdaae2dfa4c879b7deeed8',
  cacheSha256:'a61ad5a113bf1fb1e048d2dd1d8a3b99a7acc132ac3723161fefa6f419672b95',
  cacheBytes:10193,cacheBeforeBytes:9283,cacheBeforeSha256:'ed2f6710658c940c708f34ac748e572065df2ed7183e6e6401f81d2764404aa9'});
export const CACHE_PATH='assets/public-reader-cache.js';
const OUT=resolve('publications-import-publication');
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const credentials=()=>({account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN});

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
export function checkedRollbackIdentity(identity){
 assert.ok([BASELINE.codeSha256,CANDIDATE.workerSha256].includes(identity.codeSha256),'Unrecognized Worker bytes');
 assert.ok([BASELINE.settingsDigest,CREATION_SETTINGS_DIGEST].includes(identity.settingsDigest),'Worker settings changed');
 assert.equal(identity.schedulesDigest,BASELINE.schedulesDigest,'Worker schedules changed');return identity;
}
export function checkedBackupArtifacts({manifest,checkpoint,worker,cache}){
 assert.ok(manifest&&checkpoint,'Candidate manifest and preflight checkpoint are required');
 assert.ok(Buffer.isBuffer(worker)&&Buffer.isBuffer(cache),'Both rollback files must exist and be readable');
 assert.equal(checkpoint.schema,1);checkedBaseline(checkpoint.before);
 assert.equal(checkpoint.candidateSha256,sha(Buffer.from(JSON.stringify(manifest))));
 assert.equal(checkpoint.workerRollbackSha256,BASELINE.codeSha256);
 assert.equal(checkpoint.cacheRollbackSha256,CANDIDATE.cacheBeforeSha256);
 assert.ok(typeof checkpoint.cacheBeforeEtag==='string'&&checkpoint.cacheBeforeEtag.length>0&&checkpoint.cacheBeforeEtag.length<=128);
 assert.deepEqual(checkpoint.rollback,{worker:'worker-before.js',cache:'cache-before.js'});
 assert.equal(worker.length,BASELINE.workerBytes);assert.equal(sha(worker),BASELINE.codeSha256);
 assert.equal(cache.length,CANDIDATE.cacheBeforeBytes);assert.equal(sha(cache),CANDIDATE.cacheBeforeSha256);
 assert.equal(manifest.source,SOURCE);assert.equal(manifest.overlay.path,'jarvis/backend/publications.js');
 assert.equal(manifest.overlay.sha256,CANDIDATE.importerSha256);assert.deepEqual(manifest.baseline,BASELINE);
 assert.equal(manifest.candidate.workerSha256,CANDIDATE.workerSha256);assert.equal(manifest.candidate.workerBytes,CANDIDATE.workerBytes);
 assert.equal(manifest.candidate.staticBeforeSha256,CANDIDATE.cacheBeforeSha256);
 assert.equal(manifest.candidate.staticSha256,CANDIDATE.cacheSha256);assert.equal(manifest.candidate.staticBytes,CANDIDATE.cacheBytes);
 assert.equal(manifest.candidate.staticPath,CACHE_PATH);
 return true;
}
export function checkedStaticSnapshot(snapshot,expectedHash){
 assert.ok(snapshot&&typeof snapshot.etag==='string'&&snapshot.etag.length>0&&snapshot.etag.length<=128,'Exact blob ETag required');
 assert.equal(snapshot.sha256,expectedHash,'Static asset bytes changed');
 assert.ok(Number.isSafeInteger(snapshot.bytes)&&snapshot.bytes>=0,'Exact blob size required');
 return snapshot;
}
export function checkedStaticReleaseState(snapshot){
 assert.ok(snapshot&&typeof snapshot.etag==='string'&&snapshot.etag.length>0&&snapshot.etag.length<=128,'Exact blob ETag required');
 const known=new Map([[CANDIDATE.cacheBeforeSha256,CANDIDATE.cacheBeforeBytes],[CANDIDATE.cacheSha256,CANDIDATE.cacheBytes]]);
 assert.ok(known.has(snapshot.sha256),'Unrecognized static asset bytes; refusing rollback');
 assert.equal(snapshot.bytes,known.get(snapshot.sha256),'Static asset size does not match its pinned hash');return snapshot;
}
export function checkedStaticPrewrite(snapshot,{expectedHash,expectedEtag}){
 checkedStaticSnapshot(snapshot,expectedHash);assert.equal(snapshot.etag,expectedEtag,'Static asset ETag changed since rollback capture');return snapshot;
}
export function staticIfMatch(snapshot,expected){
 checkedStaticPrewrite(snapshot,expected);return ['--if-match',snapshot.etag];
}
export function planRollback(workerSha256,cacheSha256){
 assert.ok([BASELINE.codeSha256,CANDIDATE.workerSha256].includes(workerSha256),'Unrecognized Worker bytes; refusing rollback');
 assert.ok([CANDIDATE.cacheBeforeSha256,CANDIDATE.cacheSha256].includes(cacheSha256),'Unrecognized static bytes; refusing rollback');
 return Object.freeze({worker:workerSha256===CANDIDATE.workerSha256?'restore':'keep',
   cache:cacheSha256===CANDIDATE.cacheSha256?'restore':'keep'});
}
export function checkedRollbackObservation(observed){
 noDestinationActivation(observed.settings);checkedRollbackIdentity(observed.identity);
 assert.equal(fullSettingsDigest(observed.settings),observed.identity.settingsDigest,'Worker settings identity changed');
 const annotation=observed.settings.annotations?.['workers/triggered_by'];
 assert.ok(['create_version_api','upload'].includes(annotation),'Unexpected provider-generated Worker audit annotation');
 assert.equal(observed.identity.settingsDigest,annotation==='upload'?UPLOAD_SETTINGS_DIGEST:CREATION_SETTINGS_DIGEST,
  'Worker audit annotation and settings digest do not match');
 const normalized={...observed.settings,annotations:{...observed.settings.annotations,'workers/triggered_by':'create_version_api'}};
 assert.equal(fullSettingsDigest(normalized),BASELINE.normalizedSettingsDigest,'Worker settings changed beyond the provider-generated audit annotation');
 assert.equal(settingsDigest(observed.settings),BASELINE.settingsShapeDigest,'Worker binding values or shape changed');
 return observed;
}
export function checkedPublishedObservation(observed){
 noDestinationActivation(observed.settings);
 assert.equal(observed.identity.settingsDigest,fullSettingsDigest(observed.settings),'Worker settings identity changed');
 const annotation=observed.settings.annotations?.['workers/triggered_by'];
 assert.ok(['create_version_api','upload'].includes(annotation),'Unexpected provider-generated Worker audit annotation');
 assert.equal(observed.identity.settingsDigest,annotation==='upload'?UPLOAD_SETTINGS_DIGEST:CREATION_SETTINGS_DIGEST,
  'Worker audit annotation and settings digest do not match');
 const normalized={...observed.settings,annotations:{...observed.settings.annotations,'workers/triggered_by':'create_version_api'}};
 assert.equal(fullSettingsDigest(normalized),BASELINE.normalizedSettingsDigest,'Worker settings changed beyond the provider-generated audit annotation');
 assert.equal(settingsDigest(observed.settings),BASELINE.settingsShapeDigest,'Worker binding values or shape changed');
 assert.equal(observed.identity.schedulesDigest,BASELINE.schedulesDigest,'Worker schedules changed');
 return observed;
}
export async function rollbackCandidate({observeCurrent,readCache,restoreWorker,restoreCache,verifyObservation=checkedRollbackObservation}){
 let current=verifyObservation(await observeCurrent());
 const cacheState=checkedStaticReleaseState(await readCache());
 const actions=planRollback(current.identity.codeSha256,cacheState.sha256);
 if(actions.worker==='restore')await restoreWorker(current.identity);
 if(actions.cache==='restore'){
  current=verifyObservation(await observeCurrent());
  assert.equal(current.identity.codeSha256,BASELINE.codeSha256,'Worker rollback did not complete before cache restoration');
  const immediate=checkedStaticPrewrite(await readCache(),{expectedHash:CANDIDATE.cacheSha256,expectedEtag:cacheState.etag});
  await restoreCache(immediate);
 }
 const restored=verifyObservation(await observeCurrent());
 assert.equal(restored.identity.codeSha256,BASELINE.codeSha256,'Worker rollback verification failed');
 const restoredCache=checkedStaticSnapshot(await readCache(),CANDIDATE.cacheBeforeSha256);
 return {workerSha256:restored.identity.codeSha256,cacheSha256:restoredCache.sha256,workerAction:actions.worker,cacheAction:actions.cache};
}
function az(args){return execFileSync('az',args,{encoding:'utf8',stdio:'pipe',timeout:60000});}
async function cacheBytes(name='cache-live.js'){
 az(['storage','blob','download','--account-name','missionarytube','--auth-mode','login','--container-name','$web',
   '--name',CACHE_PATH,'--file',resolve(OUT,name),'--overwrite','true','--only-show-errors']);
 return readFile(resolve(OUT,name));
}
function cacheEtag(){
 const result=JSON.parse(az(['storage','blob','show','--account-name','missionarytube','--auth-mode','login','--container-name','$web',
   '--name',CACHE_PATH,'--query','{etag:properties.etag,size:properties.contentLength}','--output','json','--only-show-errors']));
 assert.equal(typeof result.etag,'string');assert.ok(Number.isSafeInteger(result.size));return result;
}
async function cacheSnapshot(name){
 const before=cacheEtag(),bytes=await cacheBytes(name),after=cacheEtag();
 assert.equal(after.etag,before.etag,'Static asset changed during capture');assert.equal(after.size,bytes.length);
 return {etag:after.etag,bytes:bytes.length,sha256:sha(bytes)};
}
export async function verifyRollbackFiles(directory=OUT){
 const [manifest,checkpoint,worker,cache]=await Promise.all([
  json(resolve(directory,'candidate.json')),json(resolve(directory,'checkpoint.json')),
  readFile(resolve(directory,'worker-before.js')),readFile(resolve(directory,'cache-before.js'))]);
 checkedBackupArtifacts({manifest,checkpoint,worker,cache});return true;
}
async function conditionalStaticUpload(file,{expectedHash,expectedEtag}){
 const expected={expectedHash,expectedEtag},live=checkedStaticPrewrite(await cacheSnapshot('cache-prewrite.js'),expected);
 az(['storage','blob','upload','--account-name','missionarytube','--auth-mode','login','--container-name','$web',
   '--name',CACHE_PATH,'--file',resolve(OUT,file),'--content-type','application/javascript','--content-cache-control','no-cache',
   ...staticIfMatch(live,expected),'--overwrite','true','--only-show-errors']);
}
async function rollback(){
 const checkpoint=await json(resolve(OUT,'checkpoint.json')),oldWorker=await readFile(resolve(OUT,'worker-before.js')),
   oldCache=await readFile(resolve(OUT,'cache-before.js'));
 const manifest=await json(resolve(OUT,'candidate.json'));
 checkedBackupArtifacts({manifest,checkpoint,worker:oldWorker,cache:oldCache});
 const {account,token}=credentials();
 const result=await rollbackCandidate({
  observeCurrent:()=>observe({account,token}),readCache:()=>cacheSnapshot('cache-live.js'),
  restoreWorker:identity=>publishWorker({account,token,bundle:oldWorker,before:identity,allowGeneratedUploadAnnotation:true}),
  restoreCache:snapshot=>conditionalStaticUpload('cache-before.js',{expectedHash:CANDIDATE.cacheSha256,expectedEtag:snapshot.etag})
 });
 assert.equal(checkpoint.before.settingsDigest,BASELINE.settingsDigest);assert.equal(checkpoint.before.schedulesDigest,BASELINE.schedulesDigest);
 console.log(JSON.stringify({rolledBack:true,...result,settingsPreservedExceptProviderAuditAnnotation:true,schedulesUnchanged:true}));
}
async function main(mode){assert.ok(['verify-backup','rollback'].includes(mode),'Historical importer supports restore only; use the normal frontend/Worker publishers');await mkdir(OUT,{recursive:true});if(mode==='verify-backup')return verifyRollbackFiles();return rollback();}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv[2]).catch(()=>{console.error('Historical importer restore stopped; no unverified replacement is allowed.');process.exitCode=1;});
