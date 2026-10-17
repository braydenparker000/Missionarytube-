import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fileManifest} from './qualified-artifact.mjs';
import {verifiedMusicReceipt,checkedMusicFrontend} from './music-frontend-identity.mjs';

const ORIGIN='https://missionarytube.z13.web.core.windows.net';
const REPO='braydenparker000/Missionarytube-';
const RELEASE_SHA='17a2ad99c4bc07671c0dcc6ae23159addf734f138beae915961b82bf66349c3f';
const RECEIPT_SHA='c064b89a4734848861d96a2bafc66cd27d359a1b090f9ca099b4a9c41bfc64f5';
const PRIVATE_SHA='e1225d3d56402c089b4347e656bdd704267680d1996e4f488f4bf1ec9ac8e3e4';
const ACTIVE_PUBLIC=Object.freeze({repository:REPO,commit:'de5d7177a778f4bfa2aa071ab064a8a4fb9b2246',
 path:'jarvis-active-public-c28/public',tree:'67a47e36414a8ceb4040c9454f64ed1982a9146c'});
export const OVERRIDES=Object.freeze({
 'assets/relay-attachment-content.js':'35d6ab366e5dab51dfbdb212ba12d29e798d0ad7352dee157774dd60c7a370ec',
 'assets/relay.css':'020ece525dace587075b361a0780fcb735def59e72d62c775c243a7e676a92fb',
 'assets/mast.js':'006a13801a3973dff467d0ba4710fd44a04324e172559798755485855f86e6e1',
 'assets/relay-owner-api.js':'9506286317847b393bd23fd19baba60b3b2cecb2f2276852b74b7ade2ca24085',
 'assets/quick-ai-config.json':'758d22439c0578977f994659725989987cba61a2da89513521f545d203c2e03f',
 'assets/relay-attachment-contract.js':'9f4d083d17ea6dc914c3c7fdcf1f8baad0dda0a323072be1f4cd7c96518d92f2',
 'assets/app.js':'867bf8f1f92e3811ffcf3336330758adfe36b762006a93eb94454eed853bd62c',
 'assets/drive-config.json':'b45dc30894fda2c7e6b6d05d9fb7dcf152d358d758f0518062edd35d4c12eff6',
 'assets/conversation.css':'e1c2c3a7382f85e74e81e8fa998f51ec554418af77e22355b32fdc027c986e63',
 'assets/relay-owner-ui.js':'6aef5fbda5c7cab14b19292cf1210cf95920972a3c7e04a44632f281e35a18e1',
 'assets/conversation.js':'7544da586d1f16197b38b3b550f61b2e834b27f957ba1017923a8c8ac2c1d77d',
 'assets/muse.js':'fa48012ea080c999a89af22b0f630f82eea9c8a5bddbdd4c1090daa59a84035d',
 'assets/hub.js':'9443bb98a5d80cb8cb5c2a3d1fc3040d1f775a8af10b41fc5dea263bce854441',
 'assets/mast.css':'62b55749a00872ab7cd82f44209a5eeacd84026a66a18dc23b25e11298a8c843',
 'muse/index.html':'d69559cfe30aeb415de5ea2ef089a36b8e0420989e0bc3f7a84fe5cffb7eea0b',
 'drawercast/r2-library.js':'859032229615470d2b3b5a2d53a9e2f46d00c74c78c75e4f0cf20b5e3029f04c',
 'drawercast/index.html':'fe360100776b4ca0f8cd416a8f929e13f85f5c73cb6cfe48ab5be8b1f6c35faf',
 'drawercast/player.js':'aede20b8b5785d4719765dc44a0a3c390159bf4fdeb5e11e9d641df83d40901a',
 'drawercast/r2-api.js':'72c1fc3e7c47aa800ac92a033703d9c11b05f45e902c832264a88ef0a06e0676',
 'mast/index.html':'84e7ded33861bd16c5c30105fe3240629204bb214111f131c5ddd5e2adfdb0f4',
 'guitar/guitar.js':'b93696dd228a5d27385e40b44af278dd3d5038caec4c8d956d646a5809c3bf2b',
 'guitar/runtime.js':'25d7c55c98e6b7effe740a66c4e08c9954e343e2e93a8bfaf7a2a1b24efaacba'
});
const DIR='.active-public-provenance',RECEIPT='release-qualified.json',PRIVATE='private-workspace-release.json',PROOF='release-component-provenance.json';
const sha=b=>createHash('sha256').update(b).digest('hex'),jsonHash=v=>sha(Buffer.from(JSON.stringify(v)));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=m=>{throw Error('Active public provenance refused: '+m);};
const get=async(path,fetcher=fetch)=>fetcher(ORIGIN+'/'+path,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
const readJson=async(path,fetcher)=>{const r=await get(path,fetcher);if(!r.ok)fail(path+'_http_'+r.status);const bytes=Buffer.from(await r.arrayBuffer());return {value:JSON.parse(bytes.toString('utf8')),bytes,response:r};};
function currentInventory(){const rows=JSON.parse(execFileSync('az',['storage','blob','list','--account-name','missionarytube','--auth-mode','login','--container-name','$web','--query','[].{name:name,etag:properties.etag,size:properties.contentLength}','--output','json'],{encoding:'utf8',stdio:'pipe',maxBuffer:16*1024*1024}));if(!Array.isArray(rows)||rows.length>10000)fail('incomplete_storage_inventory');return rows.sort((a,b)=>a.name.localeCompare(b.name));}
export function checkedLiveArtifact(files,overrides=OVERRIDES){
 if(!Array.isArray(files)||files.length!==194||new Set(files.map(f=>f.path)).size!==files.length)fail('candidate_artifact_file_set');
 const paths=Object.keys(overrides).sort();
 if(paths.length!==22||!equal(paths,Object.keys(OVERRIDES).sort())||paths.some(path=>!files.some(f=>f.path===path)))fail('preserved_override_pin_set');
 return true;
}
export function checkedPublicationProof(proof,releaseBytes,parentReceiptDigest,privateReceiptDigest){
 const keys=['activePublic','artifactManifestSha256','attempt','kind','orchestration','parentReleaseJsonSha256',
  'parentReleaseQualifiedDigest','preservedOverrides','privateWorkspaceReceiptSha256','releaseJsonSha256',
  'repository','rollback','runId','schema'].sort();
 const rollbackKeys=['artifactDigest','artifactId','name'].sort();
 if(!proof||proof.schema!==1||proof.kind!=='active-public-source-provenance'||proof.repository!==REPO||
   proof.releaseJsonSha256!==sha(releaseBytes)||proof.parentReleaseJsonSha256!==RELEASE_SHA||
  proof.parentReleaseQualifiedDigest!==RECEIPT_SHA||proof.parentReleaseQualifiedDigest!==parentReceiptDigest||
  proof.privateWorkspaceReceiptSha256!==PRIVATE_SHA||proof.privateWorkspaceReceiptSha256!==privateReceiptDigest||
  !/^[a-f0-9]{40}$/.test(proof.orchestration||'')||!/^\d+$/.test(proof.runId||'')||!/^\d+$/.test(proof.attempt||'')||
   !/^[0-9]+$/.test(String(proof.rollback?.artifactId||''))||!/^sha256:[a-f0-9]{64}$/.test(proof.rollback.artifactDigest)||
   proof.rollback.name!==`active-public-provenance-rollback-${proof.runId}-${proof.attempt}`||!equal(proof.activePublic,ACTIVE_PUBLIC)||
   !/^[a-f0-9]{64}$/.test(proof.artifactManifestSha256||'')||
   !Array.isArray(proof.preservedOverrides)||proof.preservedOverrides.length!==22||
   !equal(Object.keys(proof).sort(),keys)||!equal(Object.keys(proof.rollback||{}).sort(),rollbackKeys))fail('publication_proof_identity');
 const expected=Object.entries(OVERRIDES).map(([path,sha256])=>({path,sha256})).sort((a,b)=>a.path.localeCompare(b.path));
 if(!equal([...proof.preservedOverrides].sort((a,b)=>a.path.localeCompare(b.path)),expected))fail('publication_proof_override_set');
 return true;
}
async function preflight(){
 const releaseFile=JSON.parse(await readFile('jarvis-release.json','utf8'));
 const active=JSON.parse(await readFile('jarvis-activePublic-source.json','utf8'));
 const releaseBytes=await readFile('dist/release.json');
 const built=JSON.parse(releaseBytes.toString('utf8'));
 if(!equal(built.components?.activePublic,active)||built.commit!==releaseFile.commit||built.source!==releaseFile.repository)fail('built_release_provenance');
 const files=await fileManifest(resolve('dist'));checkedLiveArtifact(files);
 const [liveRelease,liveReceipt,privateReceipt]=await Promise.all([readJson('release.json'),readJson(RECEIPT),readJson(PRIVATE)]);
 if(sha(liveRelease.bytes)!==RELEASE_SHA||jsonHash(liveReceipt.value)!==RECEIPT_SHA||sha(privateReceipt.bytes)!==PRIVATE_SHA)fail('pinned_live_receipt_changed');
 const oldProof=await get(PROOF);if(oldProof.status!==404)fail('provenance_sidecar_already_exists');
 const privatePaths=[...(privateReceipt.value.files||[]),...(privateReceipt.value.dependencies||[])];
 if(privatePaths.length!==63||new Set(privatePaths.map(f=>f.path)).size!==63||privatePaths.some(f=>!/^[a-f0-9]{64}$/.test(f.sha256)))fail('private_receipt_file_set');
 const base=await verifiedMusicReceipt(liveReceipt.value);
 checkedMusicFrontend(releaseFile,liveRelease.value,base);
 const matched=[],preserved=[];
 for(const f of files){
  if(f.path==='release.json')continue;
  const remote=await get(f.path);if(!remote.ok)fail('candidate_path_missing_'+f.path);
  const digest=sha(Buffer.from(await remote.arrayBuffer()));
  if(digest===f.sha256){matched.push({path:f.path,sha256:digest});continue;}
  if(OVERRIDES[f.path]!==digest)fail('unexpected_live_difference_'+f.path);
  preserved.push({path:f.path,sha256:digest});
 }
 if(preserved.length!==22)fail('preserved_override_set_changed');
 for(const f of [...(privateReceipt.value.files||[]),...(privateReceipt.value.dependencies||[])]){
  const remote=await get(f.path);if(!remote.ok||sha(Buffer.from(await remote.arrayBuffer()))!==f.sha256)fail('private_receipt_mismatch_'+f.path);
 }
 await mkdir(DIR,{recursive:true});
 await writeFile(DIR+'/previous-release.json',liveRelease.bytes);
 await writeFile(DIR+'/preflight.json',JSON.stringify({parentReleaseSha256:RELEASE_SHA,parentReleaseQualifiedDigest:RECEIPT_SHA,
  privateWorkspaceReceiptSha256:PRIVATE_SHA,releaseJsonSha256:sha(releaseBytes),artifactManifestSha256:jsonHash(files),matchedCount:matched.length,preservedOverrides:preserved},null,2)+'\n');
 console.log(JSON.stringify({preflight:true,matched:matched.length,preservedOverrides:preserved.length,privateReceiptPaths:63,releaseJsonSha256:sha(releaseBytes)}));
}
async function revalidateBeforeWrite(plan){
 const [liveRelease,liveReceipt,privateReceipt]=await Promise.all([readJson('release.json'),readJson(RECEIPT),readJson(PRIVATE)]);
 if(sha(liveRelease.bytes)!==plan.parentReleaseSha256||jsonHash(liveReceipt.value)!==plan.parentReleaseQualifiedDigest||sha(privateReceipt.bytes)!==plan.privateWorkspaceReceiptSha256)fail('live_receipts_changed_before_write');
 const existingProof=await get(PROOF);if(existingProof.status!==404)fail('provenance_sidecar_changed_before_write');
 for(const f of [...(privateReceipt.value.files||[]),...(privateReceipt.value.dependencies||[])]){
  const r=await get(f.path);if(!r.ok||sha(Buffer.from(await r.arrayBuffer()))!==f.sha256)fail('private_receipt_changed_before_write_'+f.path);
 }
 for(const [path,digest] of Object.entries(OVERRIDES)){
  const r=await get(path);if(!r.ok||sha(Buffer.from(await r.arrayBuffer()))!==digest)fail('preserved_override_changed_before_write_'+path);
 }
 const files=await fileManifest(resolve('dist'));
 for(const f of files){if(f.path==='release.json'||OVERRIDES[f.path])continue;const r=await get(f.path);if(!r.ok||sha(Buffer.from(await r.arrayBuffer()))!==f.sha256)fail('candidate_file_changed_before_write_'+f.path);}
}
async function backup(){
 const before=currentInventory();
 execFileSync('az',['storage','blob','download','--account-name','missionarytube','--auth-mode','login','--container-name','$web','--name','release.json','--file',DIR+'/previous-release-storage.json','--overwrite','--only-show-errors'],{stdio:'pipe'});
 const bytes=await readFile(DIR+'/previous-release-storage.json'),expected=await readFile(DIR+'/previous-release.json');
 if(sha(bytes)!==RELEASE_SHA||!bytes.equals(expected))fail('rollback_release_changed');
 await writeFile(DIR+'/container-before.json',JSON.stringify(before,null,2)+'\n');
 await writeFile(DIR+'/rollback-manifest.json',JSON.stringify({releaseJsonSha256:sha(bytes),previousProvenanceSidecarPresent:false,containerObjectCount:before.length},null,2)+'\n');
 console.log(JSON.stringify({rollbackReady:true,releaseJsonSha256:sha(bytes),containerObjectCount:before.length}));
}
async function prepareProof(){
 const state=JSON.parse(await readFile(DIR+'/preflight.json','utf8'));
 const artifactId=process.env.ROLLBACK_ARTIFACT_ID,artifactDigest=process.env.ROLLBACK_ARTIFACT_DIGEST;
 if(!/^[0-9]+$/.test(artifactId||'')||!/^sha256:[a-f0-9]{64}$/.test(artifactDigest||''))fail('rollback_artifact_identity');
 const active=JSON.parse(await readFile('jarvis-activePublic-source.json','utf8'));
 const release=await readFile('dist/release.json');
 const proof={schema:1,kind:'active-public-source-provenance',repository:REPO,orchestration:process.env.GITHUB_SHA,
  runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,releaseJsonSha256:sha(release),
  parentReleaseJsonSha256:state.parentReleaseSha256,parentReleaseQualifiedDigest:state.parentReleaseQualifiedDigest,
  privateWorkspaceReceiptSha256:state.privateWorkspaceReceiptSha256,artifactManifestSha256:state.artifactManifestSha256,
  activePublic:active,preservedOverrides:state.preservedOverrides,
  rollback:{artifactId,artifactDigest,name:`active-public-provenance-rollback-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`}};
 checkedPublicationProof(proof,release,state.parentReleaseQualifiedDigest,state.privateWorkspaceReceiptSha256);
 await writeFile(DIR+'/provenance.json',JSON.stringify(proof,null,2)+'\n');
 if(process.env.GITHUB_OUTPUT)await writeFile(process.env.GITHUB_OUTPUT,`sha256=${sha(Buffer.from(JSON.stringify(proof)))}\n`,{flag:'a'});
 console.log(JSON.stringify({provenanceReady:true,releaseJsonSha256:proof.releaseJsonSha256,preservedOverrides:proof.preservedOverrides.length,rollbackArtifactId}));
}
async function publish(){
 const plan=JSON.parse(await readFile(DIR+'/preflight.json','utf8'));
 const proof=JSON.parse(await readFile(DIR+'/provenance.json','utf8'));
 const release=await readFile('dist/release.json'),proofBytes=await readFile(DIR+'/provenance.json');
 checkedPublicationProof(proof,release,plan.parentReleaseQualifiedDigest,plan.privateWorkspaceReceiptSha256);
 const before=JSON.parse(await readFile(DIR+'/container-before.json','utf8'));
 await revalidateBeforeWrite(plan);
 if(!equal(currentInventory(),before))fail('storage_inventory_changed_before_write');
 const upload=(name,file)=>execFileSync('az',['storage','blob','upload','--account-name','missionarytube','--auth-mode','login','--container-name','$web','--name',name,'--file',file,'--content-type','application/json','--content-cache-control','no-cache','--overwrite','true','--only-show-errors'],{stdio:'pipe'});
 // Publish the additive evidence first; release.json remains the final cutover marker.
 upload(PROOF,DIR+'/provenance.json');
 upload('release.json','dist/release.json');
 const liveRelease=await readJson('release.json'),liveProof=await readJson(PROOF);
 if(sha(liveRelease.bytes)!==proof.releaseJsonSha256||!equal(liveProof.value,proof))fail('published_bytes_mismatch');
 const after=currentInventory(),allowed=new Set(['release.json',PROOF]);
 if(!equal(after.filter(x=>!allowed.has(x.name)),before.filter(x=>!allowed.has(x.name)))||after.length!==before.length+1||!after.some(x=>x.name===PROOF))fail('unrelated_storage_object_changed');
 const root=await readJson(RECEIPT);if(jsonHash(root.value)!==RECEIPT_SHA)fail('release_qualified_receipt_changed');
 console.log(JSON.stringify({published:true,paths:['release.json',PROOF],releaseJsonSha256:proof.releaseJsonSha256,provenanceDigest:sha(proofBytes),preservedOverrides:proof.preservedOverrides.length}));
}
async function verifyPublished(){
 const [liveRelease,liveProof,liveReceipt,privateReceipt]=await Promise.all([readJson('release.json'),readJson(PROOF),readJson(RECEIPT),readJson(PRIVATE)]);
 const proof=liveProof.value;
 const releaseFile=JSON.parse(await readFile('jarvis-release.json','utf8'));
 const base=await verifiedMusicReceipt(liveReceipt.value);
 checkedMusicFrontend(releaseFile,liveRelease.value,base);
 checkedPublicationProof(proof,liveRelease.bytes,jsonHash(liveReceipt.value),sha(privateReceipt.bytes));
 if(!/application\/json/i.test(liveRelease.response.headers.get('content-type')||'')||!/(no-cache|no-store)/i.test(liveRelease.response.headers.get('cache-control')||''))fail('release_headers');
 if(proof.runId!==process.env.GITHUB_RUN_ID||proof.attempt!==process.env.GITHUB_RUN_ATTEMPT||proof.orchestration!==process.env.GITHUB_SHA||
   jsonHash(liveReceipt.value)!==RECEIPT_SHA||sha(privateReceipt.bytes)!==PRIVATE_SHA)fail('published_lineage_changed');
 const expected=Object.entries(OVERRIDES).map(([path,sha256])=>({path,sha256})).sort((a,b)=>a.path.localeCompare(b.path));
 if(!equal([...proof.preservedOverrides].sort((a,b)=>a.path.localeCompare(b.path)),expected))fail('published_preserved_override_manifest');
 for(const f of [...(privateReceipt.value.files||[]),...(privateReceipt.value.dependencies||[]),...expected]){
  const r=await get(f.path);if(!r.ok||sha(Buffer.from(await r.arrayBuffer()))!==f.sha256)fail('published_component_hash_'+f.path);
 }
 console.log(JSON.stringify({verified:true,releaseJsonSha256:proof.releaseJsonSha256,preservedOverrides:expected.length,privateReceiptPaths:63}));
}
async function rollback(){
 const plan=JSON.parse(await readFile(DIR+'/preflight.json','utf8'));
 const before=JSON.parse(await readFile(DIR+'/container-before.json','utf8'));
 const live=await readJson('release.json');
 const sidecar=await get(PROOF);
 let hasSidecar=sidecar.status===200;
 if(sidecar.status!==200&&sidecar.status!==404)fail('rollback_sidecar_http_'+sidecar.status);
 if(hasSidecar){
  const proof=JSON.parse(Buffer.from(await sidecar.arrayBuffer()).toString('utf8'));
  const localProof=JSON.parse(await readFile(DIR+'/provenance.json','utf8'));
  if(!equal(proof,localProof))fail('rollback_sidecar_identity_changed');
  if(sha(live.bytes)===proof.releaseJsonSha256){
   const previous=await readFile(DIR+'/previous-release-storage.json');
   if(sha(previous)!==plan.parentReleaseSha256)fail('rollback_artifact_release_mismatch');
   execFileSync('az',['storage','blob','upload','--account-name','missionarytube','--auth-mode','login','--container-name','$web','--name','release.json','--file',DIR+'/previous-release-storage.json','--content-type','application/json','--content-cache-control','no-cache','--overwrite','true','--only-show-errors'],{stdio:'pipe'});
  }else if(sha(live.bytes)!==plan.parentReleaseSha256)fail('rollback_live_release_unexpected');
  execFileSync('az',['storage','blob','delete','--account-name','missionarytube','--auth-mode','login','--container-name','$web','--name',PROOF,'--delete-snapshots','include','--only-show-errors'],{stdio:'pipe'});
 }else if(sha(live.bytes)!==plan.parentReleaseSha256)fail('rollback_live_release_unexpected');
 const restored=await readJson('release.json');if(sha(restored.bytes)!==plan.parentReleaseSha256)fail('rollback_restore_verification');
 const after=currentInventory(),ignored=new Set(['release.json',PROOF]);
 if(after.some(x=>x.name===PROOF)||after.length!==before.length||!equal(after.filter(x=>!ignored.has(x.name)),before.filter(x=>!ignored.has(x.name))))fail('rollback_unrelated_storage_changed');
 console.log(JSON.stringify({rolledBack:true,releaseJsonSha256:sha(restored.bytes),sidecarAbsent:true,unrelatedBlobsUnchanged:true}));
}
const command=process.argv[2];
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  if(command==='preflight')await preflight();
  else if(command==='backup')await backup();
  else if(command==='prepare-proof')await prepareProof();
  else if(command==='publish')await publish();
  else if(command==='verify-published')await verifyPublished();
  else if(command==='rollback')await rollback();
  else fail('invalid_command');
 }catch(error){console.error('Active public provenance stopped before/at guarded step: '+String(error.message||error).split('\n')[0]);process.exitCode=1;}
}
