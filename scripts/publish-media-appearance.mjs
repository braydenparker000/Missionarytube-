// Narrow, rollback-backed publisher for the two reviewed media appearance files.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {OVERRIDES,checkedPublicationProof} from './publish-active-public-provenance.mjs';
import {staticIfMatch} from './publications-import-release.mjs';

export const PARENT=Object.freeze({
 releaseSha256:'d676c6977fbfc8e44c2017342077273561c895e3b8d1d4e41583bf8601d4ce74',
 sidecarSha256:'e0a350db6bf99b3b2a59ae2f6a1ca22303cb8f28d99689dc6cf59ca8884a85e4',
 media:{repository:'braydenparker000/Missionarytube-',commit:'7520eeaea05825ef8edafc5882ef4e053e99f26d',path:'jarvis/public/media',tree:'c4d89e4aab446f6f79b17b7df911ec3c3f59e4d7'},
 bytes:21063258
});
export const CANDIDATE=Object.freeze({
 media:{repository:'braydenparker000/Missionarytube-',commit:'bccda52d2c84bdfc2d315c7250cd9efbd8594aff',path:'jarvis/public/media',tree:'4a4aceb3661e437471a1d28f6574b9b21b28a343'},
 bytes:21063373,
 files:Object.freeze({
  'media/index.html':Object.freeze({beforeBytes:5995,beforeSha256:'27adf7ba045db0912b5efe3aa9288ce9ab97b36b9672fbc07876aa5ca73fdc19',bytes:5989,sha256:'9fba937037f8ca77e1c5225c7edb702d6f90113477e35f240f4ec1aa30957d8e',contentType:'text/html'}),
  'media/assets/css/obsidian.css':Object.freeze({beforeBytes:183191,beforeSha256:'abdb7814df31e3e2bbeed041dae0841e64ac722ae30c2f5eaf35b77447b4373f',bytes:183312,sha256:'d527b53e1092abaa8d544ec0e1ec5dc6df9c5d3718ff3aa7e52d4cfbc236c67e',contentType:'text/css'})
 })
});
export const ALLOWLIST=Object.freeze(['media/index.html','media/assets/css/obsidian.css','release-component-provenance.json','release.json']);
export const PRESERVED_OVERLAY=Object.freeze({path:'assets/public-reader-cache.js',sha256:'a61ad5a113bf1fb1e048d2dd1d8a3b99a7acc132ac3723161fefa6f419672b95'});
export const PRESERVED_HASHES=Object.freeze({...OVERRIDES,[PRESERVED_OVERLAY.path]:PRESERVED_OVERLAY.sha256});
const ORIGIN='https://missionarytube.z13.web.core.windows.net',PROOF='release-component-provenance.json';
const DIR='.media-only-publication',sha=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),fail=m=>{throw Error('Media-only publication refused: '+m);};
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const az=args=>execFileSync('az',args,{encoding:'utf8',stdio:'pipe',timeout:60000,maxBuffer:16*1024*1024});
const originGet=async path=>fetch(ORIGIN+'/'+path,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});

export function checkedCandidate(parentRelease,builtRelease,files){
 assert.deepEqual(parentRelease.components?.media,PARENT.media,'Parent media component identity changed');
 assert.deepEqual(builtRelease.components?.media,CANDIDATE.media,'Built media component identity changed');
 assert.equal(builtRelease.bytes,CANDIDATE.bytes,'Built media release byte count changed');
 const parentOther={...parentRelease,bytes:builtRelease.bytes,components:{...parentRelease.components,media:builtRelease.components.media}};
 assert.deepEqual(parentOther,builtRelease,'Candidate changes a non-media release field');
 const manifest=new Map(files.map(f=>[f.path,f]));
 assert.equal(manifest.size,files.length,'Duplicate artifact path');
 assert.equal(files.length,194,'Unexpected qualified artifact file count');
 for(const [path,pin] of Object.entries(CANDIDATE.files)){
  const item=manifest.get(path);assert.ok(item,'Candidate media file missing: '+path);
  assert.equal(item.bytes,pin.bytes);assert.equal(item.sha256,pin.sha256);
 }
 assert.equal(Object.keys(OVERRIDES).length,22);
 for(const [path,pin] of Object.entries(OVERRIDES)){
  const f=manifest.get(path);assert.ok(f,'Preserved override absent from artifact: '+path);
 }
 return true;
}
export function checkedParentSidecar(sidecar,releaseSha256){
 assert.equal(releaseSha256,PARENT.releaseSha256,'Parent release bytes changed');
 assert.equal(sidecar.releaseJsonSha256,PARENT.releaseSha256,'Parent sidecar release identity changed');
 assert.equal(sidecar.preservedOverrides.length,22);
 for(const item of sidecar.preservedOverrides)assert.equal(OVERRIDES[item.path],item.sha256,'Preserved override identity changed');
 return true;
}
export function checkedPreservedHashes(actual){
 assert.ok(Array.isArray(actual),'Preserved live hash observations required');
 const rows=[...actual].sort((a,b)=>a.path.localeCompare(b.path)),expected=Object.entries(PRESERVED_HASHES)
  .map(([path,sha256])=>({path,sha256})).sort((a,b)=>a.path.localeCompare(b.path));
 assert.deepEqual(rows,expected,'Live preserved component or public-reader-cache hash changed');return true;
}
export function checkedBlobObservation(observed,{expectedHash,expectedEtag}={}){
 assert.ok(observed&&typeof observed.etag==='string'&&observed.etag.length>0&&observed.etag.length<=128,'Blob ETag required');
 assert.ok(Number.isSafeInteger(observed.bytes)&&observed.bytes>=0,'Blob byte count required');
 assert.match(observed.sha256,/^[a-f0-9]{64}$/,'Blob SHA256 required');
 if(expectedHash!==undefined)assert.equal(observed.sha256,expectedHash,'Blob bytes changed');
 if(expectedEtag!==undefined)assert.equal(observed.etag,expectedEtag,'Blob ETag changed');
 return observed;
}
export function checkedPublishedProperties(actual,expected){
 assert.equal(actual?.contentType,expected.contentType,'Published content type mismatch');
 assert.equal(actual?.cacheControl,expected.cacheControl,'Published cache control mismatch');
 assert.equal(actual?.contentDisposition||'',expected.contentDisposition||'','Published content disposition changed');
 assert.equal(actual?.contentEncoding||'',expected.contentEncoding||'','Published content encoding changed');
 assert.equal(actual?.contentLanguage||'',expected.contentLanguage||'','Published content language changed');
 const metadata=v=>Object.fromEntries(Object.entries(v||{}).sort(([a],[b])=>a.localeCompare(b)));
 assert.deepEqual(metadata(actual?.metadata),metadata(expected.metadata),'Published blob metadata changed');return true;
}
export async function uploadTransition({readCurrent,writeCandidate,readBack,before,candidate,settings}){
 const observed=checkedBlobObservation(await readCurrent(),{expectedHash:before.sha256,expectedEtag:before.etag});
 await writeCandidate({ifMatch:observed.etag,settings});
 const after=checkedBlobObservation(await readBack(),{expectedHash:candidate.sha256});
 assert.equal(after.bytes,candidate.bytes,'Published blob size mismatch');
 checkedPublishedProperties(after.properties,settings);return after;
}
export function rollbackManifest(snapshots,files,inventoryBytes){
 const entries=[];
 for(const [path,snapshot] of Object.entries(snapshots).sort(([a],[b])=>a.localeCompare(b)))
  entries.push({path,sha256:snapshot.sha256,bytes:snapshot.bytes,etag:snapshot.etag,properties:snapshot.properties,backup:snapshot.backup});
 const backupFiles=Object.entries(files).sort(([a],[b])=>a.localeCompare(b)).map(([path,bytes])=>({path,sha256:sha(bytes),bytes:bytes.length}));
 return {schema:1,snapshots:entries,files:backupFiles,inventorySha256:sha(inventoryBytes)};
}
export function checkedRollbackAction(current,before,candidate){
 if(current.sha256===before.sha256){
  assert.equal(current.bytes,before.bytes);
  const p=current.properties||{},q=before.properties||{};
  const fields=['contentType','cacheControl','contentDisposition','contentEncoding','contentLanguage','contentMd5'];
  const metadata=v=>Object.fromEntries(Object.entries(v.metadata||{}).sort(([a],[b])=>a.localeCompare(b)));
  return fields.every(k=>p[k]===q[k])&&same(metadata(p),metadata(q))?'keep':'restore';
 }
 if(current.sha256===candidate.sha256){assert.equal(current.bytes,candidate.bytes);return 'restore';}
 fail('unrecognized live bytes; refusing conditional rollback');
}
export async function restoreAllowlisted({paths=ALLOWLIST,readCurrent,readBefore,readCandidate,restore}){
 checkedAllowlist(paths);const actions=[];
 for(const path of ['media/index.html','media/assets/css/obsidian.css',PROOF,'release.json']){
  const [current,before,candidate]=await Promise.all([readCurrent(path),readBefore(path),readCandidate(path)]);
  const action=checkedRollbackAction(current,before,candidate);
  if(action==='restore')await restore(path,current,before);
  actions.push({path,action});
 }
 return actions;
}
export function checkedAllowlist(paths){
 assert.deepEqual([...paths].sort(),[...ALLOWLIST].sort(),'Publisher write set differs from exact four-object allowlist');return true;
}
export function candidateRelease(parentRelease,builtRelease){
 const next={...parentRelease,bytes:builtRelease.bytes,components:{...parentRelease.components,media:builtRelease.components.media}};
 assert.equal(sha(Buffer.from(JSON.stringify(next))),sha(Buffer.from(JSON.stringify(builtRelease))),'Only media identity and aggregate bytes may change');
 return Buffer.from(JSON.stringify(next,null,2)+'\n');
}
function inventory(){
 const rows=JSON.parse(az(['storage','blob','list','--account-name','missionarytube','--auth-mode','login','--container-name','$web',
  '--query','[].{name:name,etag:properties.etag,size:properties.contentLength}','--output','json','--only-show-errors']));
 assert.ok(Array.isArray(rows)&&rows.length>0&&rows.length<10000,'Incomplete storage inventory');return rows.sort((a,b)=>a.name.localeCompare(b.name));
}
function blobProperties(name){
 const value=JSON.parse(az(['storage','blob','show','--account-name','missionarytube','--auth-mode','login','--container-name','$web','--name',name,
  '--query','{etag:properties.etag,size:properties.contentLength,contentType:properties.contentSettings.contentType,cacheControl:properties.contentSettings.cacheControl,contentDisposition:properties.contentSettings.contentDisposition,contentEncoding:properties.contentSettings.contentEncoding,contentLanguage:properties.contentSettings.contentLanguage,contentMd5:properties.contentSettings.contentMd5,metadata:metadata}','--output','json','--only-show-errors']));
 assert.ok(typeof value.etag==='string'&&Number.isSafeInteger(value.size),'Incomplete Azure Blob properties for '+name);return value;
}
async function blobBytes(name,file){
 az(['storage','blob','download','--account-name','missionarytube','--auth-mode','login','--container-name','$web','--name',name,'--file',resolve(DIR,file),'--overwrite','true','--only-show-errors']);
 return readFile(resolve(DIR,file));
}
async function azureSnapshot(name,file){
 const p=blobProperties(name),bytes=await blobBytes(name,file),after=blobProperties(name);
 assert.equal(after.etag,p.etag,'Blob changed during rollback capture: '+name);assert.equal(bytes.length,p.size);
 return {etag:p.etag,bytes:bytes.length,sha256:sha(bytes),properties:p,backup:file};
}
function uploadArgs(path,file,observation,props){
 const args=['storage','blob','upload','--account-name','missionarytube','--auth-mode','login','--container-name','$web','--name',path,'--file',file,
  ...staticIfMatch(observation,{expectedHash:observation.sha256,expectedEtag:observation.etag}),'--overwrite','true','--only-show-errors'];
 if(props.contentType)args.push('--content-type',props.contentType);
 if(props.cacheControl)args.push('--content-cache-control',props.cacheControl);
 if(props.contentDisposition)args.push('--content-disposition',props.contentDisposition);
 if(props.contentEncoding)args.push('--content-encoding',props.contentEncoding);
 if(props.contentLanguage)args.push('--content-language',props.contentLanguage);
 if(props.contentMd5)args.push('--content-md5',props.contentMd5);
 if(props.metadata&&Object.keys(props.metadata).length)args.push('--metadata',...Object.entries(props.metadata).map(([k,v])=>`${k}=${v}`));
 return args;
}
async function snapshotHttp(path,expected,settings){
 const response=await originGet(path);assert.equal(response.status,200,'Live blob unavailable: '+path);
 const bytes=Buffer.from(await response.arrayBuffer());assert.equal(sha(bytes),expected,'Live public bytes differ: '+path);
 if(settings){assert.equal(response.headers.get('content-type'),settings.contentType);assert.equal(response.headers.get('cache-control'),settings.cacheControl);
  assert.equal(response.headers.get('content-disposition')||'',settings.contentDisposition||'');}
 return {bytes,etag:response.headers.get('etag'),contentType:response.headers.get('content-type'),cacheControl:response.headers.get('cache-control'),contentDisposition:response.headers.get('content-disposition')};
}
async function waitForPublicHash(path,expected,settings){
 let last='unavailable';
 for(let attempt=0;attempt<8;attempt++){
  try{const r=await originGet(path);if(r.status===200){const b=Buffer.from(await r.arrayBuffer());last=sha(b);if(last===expected){
   if(settings){assert.equal(r.headers.get('content-type'),settings.contentType);assert.equal(r.headers.get('cache-control'),settings.cacheControl);
    assert.equal(r.headers.get('content-disposition')||'',settings.contentDisposition||'');}
   return b;}}}
  catch(error){last=String(error.message||error).split('\n')[0];}
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 fail('public_readback_mismatch_'+path+'_'+last);
}
async function verifyPreservedPublic(){
 const observed=[];
 for(const path of Object.keys(PRESERVED_HASHES).sort()){
  const response=await originGet(path);assert.equal(response.status,200,'Preserved live object unavailable: '+path);
  const bytes=Buffer.from(await response.arrayBuffer());observed.push({path,sha256:sha(bytes)});
 }
 checkedPreservedHashes(observed);return observed;
}
async function prepare(){
 const release=await readFile('dist/release.json'),built=JSON.parse(release),files=await import('./qualified-artifact.mjs').then(m=>m.fileManifest(resolve('dist')));
 const liveRelease=await originGet('release.json');assert.equal(liveRelease.status,200);const parentBytes=Buffer.from(await liveRelease.arrayBuffer());
 const parent=JSON.parse(parentBytes.toString('utf8'));assert.equal(sha(parentBytes),PARENT.releaseSha256);
 const proofResponse=await originGet(PROOF);assert.equal(proofResponse.status,200);const proofBytes=Buffer.from(await proofResponse.arrayBuffer());
 assert.equal(sha(proofBytes),PARENT.sidecarSha256);const proof=JSON.parse(proofBytes.toString('utf8'));
 checkedPublicationProof(proof,parentBytes,proof.parentReleaseQualifiedDigest,proof.privateWorkspaceReceiptSha256);
 checkedParentSidecar(proof,sha(parentBytes));
 const [qualifiedResponse,privateResponse]=await Promise.all([originGet('release-qualified.json'),originGet('private-workspace-release.json')]);
 assert.equal(qualifiedResponse.status,200,'Parent qualification receipt unavailable');
 assert.equal(privateResponse.status,200,'Private workspace receipt unavailable');
 const qualified=JSON.parse(Buffer.from(await qualifiedResponse.arrayBuffer()).toString('utf8'));
 const privateBytes=Buffer.from(await privateResponse.arrayBuffer());
 assert.equal(sha(Buffer.from(JSON.stringify(qualified))),proof.parentReleaseQualifiedDigest,'Parent qualification receipt changed');
 assert.equal(sha(privateBytes),proof.privateWorkspaceReceiptSha256,'Private workspace receipt changed');
 checkedCandidate(parent,built,files);
 await verifyPreservedPublic();
 for(const [path,pin] of Object.entries(CANDIDATE.files))await snapshotHttp(path,pin.beforeSha256);
 const releaseCandidate=candidateRelease(parent,built);
 await mkdir(DIR,{recursive:true});
 await writeFile(resolve(DIR,'candidate-release.json'),releaseCandidate);
 await copyFile('dist/media/index.html',resolve(DIR,'index-candidate.html'));
 await copyFile('dist/media/assets/css/obsidian.css',resolve(DIR,'obsidian-candidate.css'));
 await writeFile(resolve(DIR,'candidate-files.json'),JSON.stringify(CANDIDATE.files,null,2)+'\n');
 await writeFile(resolve(DIR,'candidate.json'),JSON.stringify({schema:2,source:CANDIDATE.media,files:CANDIDATE.files,
  parentReleaseSha256:PARENT.releaseSha256,parentSidecarSha256:PARENT.sidecarSha256,parentMedia:PARENT.media,allowlist:ALLOWLIST},null,2)+'\n');
 console.log(JSON.stringify({preflight:true,source:CANDIDATE.media,mediaFiles:2,parentReceiptsPinned:true,preservedOverrides:22,allowlist:ALLOWLIST}));
}
async function backup(){
 const plan=await json(resolve(DIR,'candidate.json'));checkedAllowlist(plan.allowlist);
 const before=inventory(),snapshots={};
 for(const path of ALLOWLIST)snapshots[path]=await azureSnapshot(path,path==='release.json'?'release-before.json':path===PROOF?'provenance-before.json':path.replaceAll('/','-')+'-before.bin');
 assert.equal(snapshots['release.json'].sha256,PARENT.releaseSha256);assert.equal(snapshots[PROOF].sha256,PARENT.sidecarSha256);
 for(const [path,pin] of Object.entries(CANDIDATE.files))assert.equal(snapshots[path].sha256,pin.beforeSha256,'Azure media baseline differs: '+path);
 const publicRelease=await originGet('release.json');assert.equal(sha(Buffer.from(await publicRelease.arrayBuffer())),PARENT.releaseSha256,'Public release changed during capture');
 await writeFile(resolve(DIR,'inventory-before.json'),JSON.stringify(before,null,2)+'\n');
 await writeFile(resolve(DIR,'snapshots.json'),JSON.stringify(snapshots,null,2)+'\n');
 const files={};for(const [path,snapshot] of Object.entries(snapshots))files[path]=await readFile(resolve(DIR,snapshot.backup));
 const manifest=rollbackManifest(snapshots,files,Buffer.from(JSON.stringify(before,null,2)+'\n'));await writeFile(resolve(DIR,'rollback-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 console.log(JSON.stringify({rollbackReady:true,objects:ALLOWLIST.length,releaseSha256:snapshots['release.json'].sha256,
  sidecarSha256:snapshots[PROOF].sha256,mediaAssets:2,inventoryObjects:before.length}));
}
function settingsFor(path,before){return {...(before.properties||{}),contentType:CANDIDATE.files[path]?.contentType||'application/json',cacheControl:'no-cache',contentMd5:undefined};}
export async function verifyRollbackPackage(root=DIR,pins={source:CANDIDATE.media,parentReleaseSha256:PARENT.releaseSha256,parentSidecarSha256:PARENT.sidecarSha256,files:CANDIDATE.files}){
 const candidate=await json(resolve(root,'candidate.json')),snapshots=await json(resolve(root,'snapshots.json'));
 checkedAllowlist(candidate.allowlist);assert.equal(candidate.schema,2);
 assert.deepEqual(candidate.source,pins.source,'Recovery package source pin changed');
 assert.deepEqual(Object.keys(snapshots).sort(),[...ALLOWLIST].sort(),'Recovery snapshot set differs from exact allowlist');
 assert.equal(snapshots['release.json'].sha256,pins.parentReleaseSha256,'Recovery parent release changed');
 assert.equal(snapshots[PROOF].sha256,pins.parentSidecarSha256,'Recovery parent provenance changed');
 for(const [path,pin] of Object.entries(pins.files))assert.equal(snapshots[path].sha256,pin.beforeSha256,'Recovery media baseline changed: '+path);
 const manifest=await json(resolve(root,'rollback-manifest.json'));
 const files={};for(const [path,snap] of Object.entries(snapshots)){const bytes=await readFile(resolve(root,snap.backup));assert.equal(bytes.length,snap.bytes);assert.equal(sha(bytes),snap.sha256);files[path]=bytes;}
 const inventoryBytes=await readFile(resolve(root,'inventory-before.json'));
 assert.deepEqual(manifest,rollbackManifest(snapshots,files,inventoryBytes),'Rollback manifest does not bind exact captured files');
 const candidateRelease=await readFile(resolve(root,'candidate-release.json'));
 assert.equal(sha(candidateRelease),candidate.candidateReleaseSha256,'Candidate release package identity changed');
 const proof=JSON.parse(await readFile(resolve(root,'candidate-provenance.json'),'utf8'));
 assert.equal(proof.releaseJsonSha256,sha(candidateRelease));
 assert.deepEqual(proof.mediaPublication.source,pins.source,'Recovery candidate source changed');
 assert.deepEqual(proof.mediaPublication.files,Object.entries(pins.files).map(([path,f])=>({path,sha256:f.sha256,bytes:f.bytes})),'Recovery candidate file pins changed');
 assert.deepEqual(proof.mediaPublication.run,{orchestration:candidate.orchestration,runId:candidate.runId,attempt:candidate.attempt});
 assert.equal(proof.mediaPublication.rollback.manifestSha256,sha(await readFile(resolve(root,'rollback-manifest.json'))));
 assert.equal(proof.mediaPublication.rollback.name,`media-only-rollback-${candidate.runId}-${candidate.attempt}`);
 return {candidate,snapshots,manifest,proof};
}
async function backupArtifact(){
 const {snapshots}=await verifyRollbackPackage(),inventoryBefore=await json(resolve(DIR,'inventory-before.json'));
 await checkInventory(inventoryBefore);
}
async function makeProof(){
 assert.match(process.env.GITHUB_SHA||'',/^[a-f0-9]{40}$/);assert.match(process.env.GITHUB_RUN_ID||'',/^[0-9]+$/);
 assert.match(process.env.GITHUB_RUN_ATTEMPT||'',/^[0-9]+$/);
 const parentProof=JSON.parse((await readFile(resolve(DIR,'provenance-before.json'))).toString('utf8'));
 const release=await readFile(resolve(DIR,'candidate-release.json'));
 const published={schema:2,kind:'component-release-provenance',repository:'braydenparker000/Missionarytube-',
  releaseJsonSha256:sha(release),parent:{releaseJsonSha256:PARENT.releaseSha256,sidecarSha256:PARENT.sidecarSha256},
  activePublicProvenance:parentProof,activePublic:parentProof.activePublic,preservedOverrides:parentProof.preservedOverrides,
  mediaPublication:{source:CANDIDATE.media,files:Object.entries(CANDIDATE.files).map(([path,f])=>({path,sha256:f.sha256,bytes:f.bytes})),
   preservedLive:Object.entries(PRESERVED_HASHES).map(([path,sha256])=>({path,sha256})).sort((a,b)=>a.path.localeCompare(b.path)),
   run:{orchestration:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT},
   rollback:{name:`media-only-rollback-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`,manifestSha256:sha(await readFile(resolve(DIR,'rollback-manifest.json')))}}};
 await writeFile(resolve(DIR,'candidate-provenance.json'),JSON.stringify(published,null,2)+'\n');
 const allowlist=await json(resolve(DIR,'candidate.json'));assert.deepEqual(allowlist.allowlist,ALLOWLIST);
 allowlist.orchestration=process.env.GITHUB_SHA;allowlist.runId=process.env.GITHUB_RUN_ID;allowlist.attempt=process.env.GITHUB_RUN_ATTEMPT;
 allowlist.candidateReleaseSha256=sha(release);await writeFile(resolve(DIR,'candidate.json'),JSON.stringify(allowlist,null,2)+'\n');
 console.log(JSON.stringify({provenanceReady:true,releaseJsonSha256:sha(release),sidecarSha256:sha(Buffer.from(JSON.stringify(published,null,2)+'\n')),rollbackArtifact:published.mediaPublication.rollback.name}));
}
async function observed(path){const props=blobProperties(path),snap=await azureSnapshot(path,'observation.bin');assert.equal(snap.etag,props.etag);return snap;}
async function uploadCandidate(path,file,candidate,before){
 const props=settingsFor(path,before);
 return uploadTransition({before, candidate, settings:props, readCurrent:()=>observed(path),
  writeCandidate:({ifMatch,settings})=>{
   const current={sha256:before.sha256,etag:ifMatch,bytes:before.bytes};
   az(uploadArgs(path,resolve(DIR,file),current,settings));
  },readBack:async()=>{
   const after=await observed(path);const bytes=await waitForPublicHash(path,candidate.sha256,props);
   assert.equal(sha(bytes),candidate.sha256);return {...after,properties:after.properties};
  }});
}
export async function restorePackagedAllowlist({root=DIR,readCurrent,restore,pins}){
 const {snapshots,proof}=await verifyRollbackPackage(root,pins),candidateRelease=await readFile(resolve(root,'candidate-release.json'));
 const files=Object.fromEntries(proof.mediaPublication.files.map(f=>[f.path,f]));
 const sidecar=await readFile(resolve(root,'candidate-provenance.json'));
 const candidates={...files,[PROOF]:{sha256:sha(sidecar),bytes:sidecar.length},'release.json':{sha256:sha(candidateRelease),bytes:candidateRelease.length}};
 assert.deepEqual(Object.keys(candidates).sort(),[...ALLOWLIST].sort(),'Recovery candidate identity does not match allowlist');
 return restoreAllowlisted({readCurrent,readBefore:async path=>snapshots[path],readCandidate:async path=>candidates[path],restore});
}
async function checkInventory(before){
 const after=inventory(),other=ALLOWLIST;
 const strip=rows=>rows.filter(r=>!other.includes(r.name));
 assert.ok(same(strip(after),strip(before)),'Unlisted storage object changed');
 assert.equal(after.length,before.length,'Publisher changed object count');
}
async function publish(){
 const plan=await json(resolve(DIR,'candidate.json')),snapshots=await json(resolve(DIR,'snapshots.json'));
 checkedAllowlist(plan.allowlist);await backupArtifact();
 const candidateProof=await readFile(resolve(DIR,'candidate-provenance.json'));
 const proofValue=JSON.parse(candidateProof.toString('utf8'));
 assert.equal(proofValue.parent.releaseJsonSha256,PARENT.releaseSha256);
 assert.equal(proofValue.parent.sidecarSha256,PARENT.sidecarSha256);
 await verifyPreservedPublic();
 const expected={...CANDIDATE.files,'release-component-provenance.json':{sha256:sha(candidateProof),bytes:candidateProof.length},
  'release.json':{sha256:sha(await readFile(resolve(DIR,'candidate-release.json'))),bytes:(await readFile(resolve(DIR,'candidate-release.json'))).length}};
 for(const path of ['media/index.html','media/assets/css/obsidian.css'])await uploadCandidate(path,path==='media/index.html'?'index-candidate.html':'obsidian-candidate.css',expected[path],snapshots[path]);
 await writeFile(resolve(DIR,'provenance-candidate.json'),candidateProof);
 await uploadCandidate(PROOF,'provenance-candidate.json',expected[PROOF],snapshots[PROOF]);
 await uploadCandidate('release.json','candidate-release.json',expected['release.json'],snapshots['release.json']);
 await verifyPreservedPublic();
 await checkInventory(await json(resolve(DIR,'inventory-before.json')));
 const liveProof=await originGet(PROOF),liveRelease=await originGet('release.json');
 assert.equal(sha(Buffer.from(await liveProof.arrayBuffer())),expected[PROOF].sha256);
 assert.equal(sha(Buffer.from(await liveRelease.arrayBuffer())),expected['release.json'].sha256);
 console.log(JSON.stringify({published:true,paths:ALLOWLIST,mediaFiles:2,releaseJsonSha256:expected['release.json'].sha256,
  componentProvenanceSha256:expected[PROOF].sha256,preservedOverrides:22,nonAllowlistedBlobsUnchanged:true}));
}
async function rollback(){
 const {snapshots,proof}=await verifyRollbackPackage();await checkInventory(await json(resolve(DIR,'inventory-before.json')));
 assert.equal(proof.mediaPublication.source.commit,CANDIDATE.media.commit,'Recovery package source identity mismatch');
 const actions=await restorePackagedAllowlist({readCurrent:observed,restore:async(path,current,before)=>{
  const file=before.backup,props=before.properties;
  az(uploadArgs(path,resolve(DIR,file),current,props));
  const restored=await observed(path);assert.equal(restored.sha256,before.sha256);assert.equal(restored.bytes,before.bytes);
  assert.equal(checkedRollbackAction(restored,before,{sha256:'candidate',bytes:0}),'keep','Blob content settings were not restored');
  await waitForPublicHash(path,before.sha256,before.properties);
 }});
 const beforeInventory=await json(resolve(DIR,'inventory-before.json'));await checkInventory(beforeInventory);
 for(const path of ALLOWLIST){const restored=await observed(path);assert.equal(restored.sha256,snapshots[path].sha256);
  assert.equal(checkedRollbackAction(restored,snapshots[path],{sha256:'candidate',bytes:0}),'keep','Blob content settings were not restored');}
 await verifyPreservedPublic();
 console.log(JSON.stringify({rolledBack:true,paths:ALLOWLIST,actions,exactParentBytesRestored:true,nonAllowlistedBlobsUnchanged:true}));
}
async function main(mode){
 await mkdir(DIR,{recursive:true});
 if(mode==='prepare')return prepare();if(mode==='backup')return backup();if(mode==='prepare-proof')return makeProof();if(mode==='verify-package')return verifyRollbackPackage();
 if(mode==='verify-backup')return backupArtifact();if(mode==='publish')return publish();if(mode==='rollback')return rollback();
 fail('invalid_command');
}
const command=process.argv[2];
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{await main(command);}catch(error){console.error('Media-only publication stopped before/at guarded step: '+String(error.message||error).split('\n')[0]);process.exitCode=1;}
}
