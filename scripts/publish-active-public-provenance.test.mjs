import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkedLiveArtifact,checkedPublicationProof,OVERRIDES} from './publish-active-public-provenance.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const activePublic={repository:'braydenparker000/Missionarytube-',commit:'de5d7177a778f4bfa2aa071ab064a8a4fb9b2246',
 path:'jarvis-active-public-c28/public',tree:'67a47e36414a8ceb4040c9454f64ed1982a9146c'};
const files=[...Object.keys(OVERRIDES),...Array.from({length:172},(_,i)=>`candidate-${i}.js`)];

test('the candidate must preserve the exact 194-file set and all 22 pinned live overrides',()=>{
 assert.equal(files.length,194);
 assert.equal(checkedLiveArtifact(files.map(path=>({path}))),true);
 assert.throws(()=>checkedLiveArtifact(files.slice(1).map(path=>({path}))),/candidate_artifact_file_set|preserved_override_pin_set/);
 assert.throws(()=>checkedLiveArtifact(['new-file.js',...files.slice(1)].map(path=>({path}))),/preserved_override_pin_set/);
});

test('publication proof binds active source, prior receipts, run and rollback artifact',()=>{
 const release=Buffer.from('{"source":"braydenparker999/jarvis"}');
 const proof={schema:1,kind:'active-public-source-provenance',repository:'braydenparker000/Missionarytube-',
  releaseJsonSha256:sha(release),parentReleaseJsonSha256:'17a2ad99c4bc07671c0dcc6ae23159addf734f138beae915961b82bf66349c3f',
  parentReleaseQualifiedDigest:'c064b89a4734848861d96a2bafc66cd27d359a1b090f9ca099b4a9c41bfc64f5',
  privateWorkspaceReceiptSha256:'e1225d3d56402c089b4347e656bdd704267680d1996e4f488f4bf1ec9ac8e3e4',
  orchestration:'a'.repeat(40),runId:'123456',attempt:'1',artifactManifestSha256:'b'.repeat(64),activePublic,
  preservedOverrides:Object.entries(OVERRIDES).map(([path,sha256])=>({path,sha256})),
  rollback:{artifactId:'7',artifactDigest:'sha256:'+'c'.repeat(64),name:'active-public-provenance-rollback-123456-1'}};
 assert.equal(checkedPublicationProof(proof,release,proof.parentReleaseQualifiedDigest,proof.privateWorkspaceReceiptSha256),true);
 for(const broken of [
  {...proof,activePublic:{...activePublic,tree:'f'.repeat(40)}},
  {...proof,rollback:{...proof.rollback,artifactId:'nope'}},
  {...proof,preservedOverrides:proof.preservedOverrides.slice(1)}
 ])assert.throws(()=>checkedPublicationProof(broken,release,proof.parentReleaseQualifiedDigest,proof.privateWorkspaceReceiptSha256));
});

test('prepare-proof completes proof binding and success logging with real rollback inputs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'active-public-proof-'));
 try{
  await mkdir(resolve(root,'.active-public-provenance'),{recursive:true});
  await mkdir(resolve(root,'dist'),{recursive:true});
  const release=Buffer.from('{"fixture":true}\n');
  const runId='39006811800',attempt='1',artifactId='123456789',artifactDigest='sha256:'+'c'.repeat(64);
  const state={parentReleaseSha256:'17a2ad99c4bc07671c0dcc6ae23159addf734f138beae915961b82bf66349c3f',
   parentReleaseQualifiedDigest:'c064b89a4734848861d96a2bafc66cd27d359a1b090f9ca099b4a9c41bfc64f5',
   privateWorkspaceReceiptSha256:'e1225d3d56402c089b4347e656bdd704267680d1996e4f488f4bf1ec9ac8e3e4',
   releaseJsonSha256:sha(release),artifactManifestSha256:'b'.repeat(64),
   preservedOverrides:Object.entries(OVERRIDES).map(([path,sha256])=>({path,sha256}))};
  await writeFile(resolve(root,'jarvis-activePublic-source.json'),JSON.stringify(activePublic));
  await writeFile(resolve(root,'dist/release.json'),release);
  await writeFile(resolve(root,'.active-public-provenance/preflight.json'),JSON.stringify(state));
  const script=fileURLToPath(new URL('./publish-active-public-provenance.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[script,'prepare-proof'],{cwd:root,encoding:'utf8',env:{...process.env,
   GITHUB_SHA:'e8ab4bf0b0496e8549ad4d09986a64466cf5f24e',GITHUB_RUN_ID:runId,GITHUB_RUN_ATTEMPT:attempt,
   ROLLBACK_ARTIFACT_ID:artifactId,ROLLBACK_ARTIFACT_DIGEST:artifactDigest}});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stdout),{provenanceReady:true,releaseJsonSha256:sha(release),preservedOverrides:22,artifactId});
  const proof=JSON.parse(await readFile(resolve(root,'.active-public-provenance/provenance.json'),'utf8'));
  assert.deepEqual(proof.rollback,{artifactId,artifactDigest,name:`active-public-provenance-rollback-${runId}-${attempt}`});
 }finally{await rm(root,{recursive:true,force:true});}
});

test('manual publication is artifact-scoped, rollback-backed, and cannot start the general deploy job',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/deploy-azure-storage.yml',import.meta.url),'utf8');
 const job=workflow.split('  active-public-provenance:\n')[1].split('  mobile-file-save:\n')[0];
 assert.ok(job.includes("inputs.publish_active_public_provenance == true"));
 assert.ok(job.includes("vars.AZURE_DEPLOY_ENABLED == 'true'"));
 assert.ok(job.indexOf('Capture exact rollback bytes')<job.indexOf('Preserve rollback artifact before publication'));
 assert.ok(job.indexOf('Preserve rollback artifact before publication')<job.indexOf('Publish only release.json and its component provenance sidecar'));
 assert.ok(job.indexOf('Publish only release.json and its component provenance sidecar')<job.indexOf('Verify published lineage'));
 assert.ok(job.includes('Restore the parent release if publication or verification fails'));
 assert.doesNotMatch(job,/upload-batch|release-qualified\.json.*--overwrite/);
 const general=workflow.split('  deploy:\n')[1].split('\n  [a-z-]+:\n')[0];
 assert.ok(general.includes('inputs.publish_active_public_provenance != true'));
});
