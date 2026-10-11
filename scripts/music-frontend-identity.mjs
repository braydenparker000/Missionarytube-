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
