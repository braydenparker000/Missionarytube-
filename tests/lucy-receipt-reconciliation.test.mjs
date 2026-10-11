import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {checkedFrontendSources,checkedLiveFrontend} from '../scripts/reconcile-lucy-receipt.mjs';
import {receiptDigest} from '../scripts/worker-release-identity.mjs';
const source='363f710068bb6f2c456dbbf183f063484a36fe11',head='40835db24e9036a33d26f9a57e7c8c9851ec1208';
const files=[{path:'index.html',sha256:'a'.repeat(64),bytes:10},{path:'release.json',sha256:'b'.repeat(64),bytes:20}];
const prior={identity:{repository:'braydenparker000/Missionarytube-',orchestration:head,source,runId:'38139432843',attempt:'1'},files};
test('frontend preservation binds exact old provenance and every public byte',()=>{
 const current=structuredClone(prior);current.files[1].sha256='c'.repeat(64);checkedFrontendSources(prior,current);
 current.files[0].sha256='d'.repeat(64);assert.throws(()=>checkedFrontendSources(prior,current));
 assert.throws(()=>checkedFrontendSources({...prior,identity:{...prior.identity,attempt:'2'}},prior));
 const receipt={source,orchestration:head,frontendArtifactDigest:receiptDigest({identity:{...prior.identity,baseManifestDigest:receiptDigest(prior)},files}),publicConfigurationDigest:createHash('sha256').update('[]').digest('hex')};
 checkedLiveFrontend(prior,files,receipt);
 assert.throws(()=>checkedLiveFrontend(prior,current.files,receipt));
 assert.throws(()=>checkedLiveFrontend(prior,files,{...receipt,publicConfigurationDigest:'f'.repeat(64)}));
});
test('receipt-only workflow excludes all Worker and frontend writes with unchanged permissions',()=>{
 const flow=readFileSync('.github/workflows/deploy-azure-storage.yml','utf8');
 assert.match(flow,/permissions:\n  contents: read\n  id-token: write/);
 assert.ok(!flow.includes('actions: read'));
 for(const step of flow.split('      - name: ').slice(1)){
  if(/cloudflare\/wrangler-action|configure-quick-ai|configure-drive|publish-drive-catalog|stage-relay-core|upload-batch|--name index.html/.test(step))assert.match(step,/if:.*receipt_only != 'true'/);
 }
 assert.match(flow,/--name release-qualified.json --file release-qualified.json/);
 assert.match(flow,/node scripts\/reconcile-lucy-receipt.mjs verify-published/);
 const script=readFileSync('scripts/reconcile-lucy-receipt.mjs','utf8');
 assert.ok(!/method:\s*['"](?:POST|PUT|PATCH|DELETE)/.test(script));
 assert.match(script,/frontendSource:existing.source/);
});
