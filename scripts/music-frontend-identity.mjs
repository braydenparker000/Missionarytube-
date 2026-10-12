import {checkedMuseLauncherReceipt} from './publish-muse-launcher.mjs';
import {checkedPowerampReceipt} from './publish-poweramp-background.mjs';
import {checkedOwnerMastReceipt} from './activate-owner-mast.mjs';
import {checkedMastGateReceipt} from './deploy-mast-chat-only.mjs';
import {checkedWakeReceipt} from './deploy-private-wake.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Finite preserved-frontend release: this digest was verified by the successful
// receipt-only release 38168396000, attempt 1. Never infer a pin from live input.
const RECEIPT='03c33d919658af489451e9b0997db6363a95bd5682463b5ff47308f3e4bc73c7';
const WORKER='c28c1b2f70aabb5217b08bf31ffe4c93d0353765';
const FRONTEND='363f710068bb6f2c456dbbf183f063484a36fe11';
export function checkedMusicFrontend(release,current,receipt){
  assert.equal(current.source,'braydenparker999/jarvis');
  if(release.workerDeploymentPolicy?.mode==='reconcile-lucy-discovery'){
    assert.equal(release.commit,WORKER);
    assert.equal(createHash('sha256').update(JSON.stringify(receipt)).digest('hex'),RECEIPT,'verified reconciliation receipt changed');
    assert.equal(receipt.source,WORKER);assert.equal(receipt.frontendSource,FRONTEND);
    assert.equal(current.commit,FRONTEND);
    return {commit:FRONTEND,workerSource:WORKER,receiptDigest:RECEIPT};
  }
  assert.equal(current.commit,release.commit);
  return {commit:current.commit,workerSource:release.commit};
}

export async function verifiedMusicReceipt(receipt,fetcher=fetch){
 const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 if(hash(receipt)===RECEIPT)return receipt;
 if(receipt.launcherPatch||receipt.frontendPatch||receipt.ownerMastActivation||receipt.mastGatePatch||receipt.workerPatch){
  const parent=receipt.launcherPatch?checkedMuseLauncherReceipt(receipt):receipt.frontendPatch?checkedPowerampReceipt(receipt):receipt.ownerMastActivation?checkedOwnerMastReceipt(receipt):receipt.mastGatePatch?checkedMastGateReceipt(receipt):checkedWakeReceipt(receipt),repo='braydenparker000/Missionarytube-',base='https://api.github.com/repos/'+repo;
  const get=async path=>{const r=await fetcher(base+path,{redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);return r.json();};
  const run=await get('/actions/runs/'+receipt.runId);
  assert.equal(run.repository.full_name,repo);assert.equal(run.head_repository.full_name,repo);assert.notEqual(run.head_repository.fork,true);
  assert.equal(String(run.id),receipt.runId);assert.equal(run.head_sha,receipt.orchestration);assert.equal(run.run_attempt,Number(receipt.attempt));
  assert.equal(run.head_branch,'main');assert.equal(run.event,'workflow_dispatch');assert.equal(run.path,'.github/workflows/deploy-azure-storage.yml');
  assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
  const page=await get('/actions/runs/'+receipt.runId+'/attempts/'+receipt.attempt+'/jobs?per_page=100');
  assert.equal(page.total_count,page.jobs.length);
  const jobs=page.jobs.filter(j=>j.name==='deploy'&&j.status==='completed'&&j.conclusion==='success');assert.equal(jobs.length,1);
  const j=jobs[0];assert.equal(j.run_id,run.id);assert.equal(j.run_attempt,run.run_attempt);assert.equal(j.head_sha,run.head_sha);
  const stamps=j.steps.filter(s=>s.name==='verified-production-receipt-'+hash(receipt));assert.equal(stamps.length,1);
  assert.equal(stamps[0].status,'completed');assert.equal(stamps[0].conclusion,'success');
  return verifiedMusicReceipt(parent,fetcher);
 }
 const a=receipt.activation,parent=a?.parentReceipt;
 const parentDigest=hash(parent),replacementBase='c61900082c954c1c9a5ffd6cb8736532b14da778ff71a4c53a6aaed3c2d649be';
 assert.ok([RECEIPT,replacementBase].includes(parentDigest));assert.equal(a.kind,'lucy-muse-channel');
 assert.equal(a.fingerprint,parentDigest===replacementBase?'c6395979c5ec29b1edd1ee15c8bd4ef2733c23684802c61f0c6efef6157718d6':'7cc3b9c2b3bbc0f5ee4947b5987b71a95310749b8d042f0c66e77c60727467a3');
 assert.deepEqual(Object.keys(a).sort(),['codeDigest','expectedSettingsDigest','fingerprint','kind','parentReceipt']);
 for(const value of [a.codeDigest,a.expectedSettingsDigest,receipt.settingsDigest])assert.match(value,/^[a-f0-9]{64}$/);
 assert.match(receipt.orchestration,/^[a-f0-9]{40}$/);assert.match(receipt.version,/^[a-f0-9-]{36}$/);
 assert.match(receipt.runId,/^[1-9][0-9]*$/);assert.match(receipt.attempt,/^[1-9][0-9]*$/);
 assert.deepEqual(receipt,{...parent,version:receipt.version,settingsDigest:receipt.settingsDigest,orchestration:receipt.orchestration,runId:receipt.runId,attempt:receipt.attempt,activation:a});
 const repo='braydenparker000/Missionarytube-',base='https://api.github.com/repos/'+repo;
 const get=async path=>{const r=await fetcher(base+path,{redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);return r.json();};
 const run=await get('/actions/runs/'+receipt.runId);
 assert.equal(run.repository.full_name,repo);assert.equal(run.head_repository.full_name,repo);assert.notEqual(run.head_repository.fork,true);
 assert.equal(run.head_sha,receipt.orchestration);assert.equal(run.run_attempt,Number(receipt.attempt));assert.equal(run.head_branch,'main');
 assert.equal(run.event,'workflow_dispatch');assert.equal(run.path,'.github/workflows/deploy-azure-storage.yml');assert.equal(run.conclusion,'success');
 const jobs=await get('/actions/runs/'+receipt.runId+'/attempts/'+receipt.attempt+'/jobs?per_page=100');
 assert.equal(jobs.total_count,jobs.jobs.length);
 assert.ok(jobs.jobs.some(j=>j.name==='deploy'&&j.head_sha===receipt.orchestration&&j.run_attempt===Number(receipt.attempt)&&j.conclusion==='success'&&j.steps.some(s=>s.name==='verified-production-receipt-'+hash(receipt)&&s.conclusion==='success')));
 return parentDigest===RECEIPT?parent:parent.activation.parentReceipt;
}
