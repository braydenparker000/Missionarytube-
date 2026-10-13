import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readWorkerSettings} from './check-music-worker-bindings.mjs';
import {activeVersion,settingsDigest} from './worker-release-identity.mjs';
export const WORKER=Object.freeze({source:'099ec1a0b2b621a3799f4f8346490903f212a912',version:'54544c04-10e7-4087-9edf-54fe55ea97e0',codeSha256:'e12a5f82dcf64ebf2e83840a72fbff86e8b172f67eada8032e7615b8d547cf70'});
export const PROVENANCE=Object.freeze({sourceRun:38388559662,acceptedPartialRun:38397242912,acceptedOrchestration:'ca5775c13e2166fd82f40a6788b4520833523abe',inspectionRun:38403697569,inspectionOrchestration:'f1740658b9479e65179829331431f3a6550250ce'});
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export function fullSettingsDigest(settings){return hash(JSON.stringify(canonical({...settings,bindings:[...settings.bindings].sort((a,b)=>a.name.localeCompare(b.name))})));}
export function checkedCheckpoint(value){
 assert.deepEqual(Object.keys(value).sort(),['codeSha256','fullSettingsDigest','makimaEnabled','provenance','settingsDigest','source','version']);
 for(const [key,expected] of Object.entries(WORKER))assert.equal(value[key],expected,'Current Worker '+key+' does not match the reconciled deployment');
 assert.equal(value.makimaEnabled,false,'Makima must remain disabled');assert.match(value.settingsDigest,/^[a-f0-9]{64}$/);assert.match(value.fullSettingsDigest,/^[a-f0-9]{64}$/);assert.deepEqual(value.provenance,PROVENANCE);return value;
}
export const workerCheckpointDigest=value=>hash(JSON.stringify({schema:'read-only-saving-worker-v1',...checkedCheckpoint(value)}));
// Fixed public metadata reads. A failed whole run is never treated as a successful
// qualification: the accepted partial upload has its own pinned reference, while
// code qualification and the later read-only inspection must both have succeeded.
export async function verifyWorkerProvenance(fetcher=globalThis.fetch){
 const get=async(repo,path)=>{const r=await fetcher('https://api.github.com/repos/'+repo+'/actions/'+path,{method:'GET',redirect:'error',headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,'Worker provenance unavailable');return r.json();};
 const sourceRepo='braydenparker999/jarvis',deployRepo='braydenparker000/Missionarytube-';
 const run=async(repo,id,sha,event,branch,path,conclusion)=>{const r=await get(repo,'runs/'+id);assert.equal(r.id,id);assert.equal(r.run_attempt,1);assert.equal(r.repository?.full_name,repo);assert.equal(r.head_repository?.full_name,repo);assert.notEqual(r.head_repository?.fork,true);assert.equal(r.head_sha,sha);assert.equal(r.event,event);assert.equal(r.head_branch,branch);assert.equal(r.path,path);assert.equal(r.status,'completed');assert.equal(r.conclusion,conclusion);return r;};
 await run(sourceRepo,PROVENANCE.sourceRun,WORKER.source,'push','release/astra-live-backport-20261009','.github/workflows/validate-r2.yml','success');
 const sj=await get(sourceRepo,'runs/'+PROVENANCE.sourceRun+'/attempts/1/jobs?per_page=100');assert.equal(sj.total_count,sj.jobs?.length);
 for(const prefix of ['qualified-source-',...['relay','frontend','poweramp','blankLibrary','podcasts','migration','performance','owner24'].map(n=>'qualified-'+n+'-')]){const rows=sj.jobs.filter(j=>j.name.startsWith(prefix)&&/^[a-f0-9]{64}$/.test(j.name.slice(prefix.length)));assert.equal(rows.length,1);const j=rows[0];assert.equal(j.run_id,PROVENANCE.sourceRun);assert.equal(j.run_attempt,1);assert.equal(j.head_sha,WORKER.source);assert.equal(j.status,'completed');assert.equal(j.conclusion,'success');}
 await run(deployRepo,PROVENANCE.acceptedPartialRun,PROVENANCE.acceptedOrchestration,'workflow_dispatch','release/makima-control-20261013','.github/workflows/deploy-music-worker.yml','failure');
 await run(deployRepo,PROVENANCE.inspectionRun,PROVENANCE.inspectionOrchestration,'workflow_dispatch','release/makima-control-20261013','.github/workflows/deploy-music-worker.yml','success');
 const ij=await get(deployRepo,'runs/'+PROVENANCE.inspectionRun+'/attempts/1/jobs?per_page=100');assert.equal(ij.total_count,ij.jobs?.length);const observed=ij.jobs.filter(j=>j.name==='makima-inspect');assert.equal(observed.length,1);
 for(const j of ij.jobs){assert.equal(j.run_id,PROVENANCE.inspectionRun);assert.equal(j.run_attempt,1);assert.equal(j.head_sha,PROVENANCE.inspectionOrchestration);assert.equal(j.status,'completed');assert.equal(j.conclusion,j.name==='makima-inspect'?'success':'skipped');}
 return PROVENANCE;
}
// Provider access is GET-only. Plaintext settings are hashed in memory and never
// returned/logged; secret-value endpoints and all mutations are absent.
export async function observeWorker({account,token,fetcher=globalThis.fetch}){
 const api=async path=>{const r=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/${path}`,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,'Worker read failed');return r;};
 const before=await readWorkerSettings({account,token,fetcher});assert.equal(new Set(before.bindings.map(b=>b.name)).size,before.bindings.length,'Duplicate Worker bindings');const digest=settingsDigest(before),full=fullSettingsDigest(before);
 const flag=before.bindings.find(b=>b.name==='RELAY_MAKIMA_ENABLED');assert.equal(flag?.type,'plain_text');assert.equal(flag.text,'false','Makima is not explicitly disabled');
 const version=activeVersion(await(await api('deployments?per_page=1')).json());
 const content=await api('content/v2'),files=[...(await content.formData()).entries()].filter(([,v])=>typeof v!=='string');assert.equal(files.length,1);assert.equal(files[0][0],'worker.js');assert.ok(files[0][1].size>0&&files[0][1].size<1024*1024,'Unexpected Worker bundle size');const codeSha256=hash(Buffer.from(await files[0][1].arrayBuffer()));
 const after=await readWorkerSettings({account,token,fetcher});assert.equal(fullSettingsDigest(after),full,'Worker settings changed during read-only inspection');assert.equal(activeVersion(await(await api('deployments?per_page=1')).json()),version,'Worker changed during inspection');
 return {source:WORKER.source,version,codeSha256,settingsDigest:digest,fullSettingsDigest:full,makimaEnabled:false,provenance:PROVENANCE};
}
export async function reconcileWorker(options){await verifyWorkerProvenance(options?.provenanceFetcher);return checkedCheckpoint(await observeWorker(options));}
export async function verifyWorkerCheckpoint(expected,options){checkedCheckpoint(expected);assert.deepEqual(checkedCheckpoint(await observeWorker(options)),expected,'Worker or settings changed since the read-only checkpoint');}
