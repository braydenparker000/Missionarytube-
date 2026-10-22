// Reuse the successful main CI artifact; never start another qualification or
// accept a PR/fork artifact as production evidence.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkedReviewedCommit} from './publish-daily-board.mjs';
const REPO='braydenparker000/Missionarytube-';
// Every check names itself, so a refusal says which evidence is missing.
export function checkedValidation(run,head,jobs,artifacts){
 assert.match(head,/^[a-f0-9]{40}$/,'The commit must be a full 40-character lowercase SHA');assert.equal(run.head_sha,head,'Validate run is for another commit');
 assert.equal(run.repository?.full_name,REPO,'Validate run belongs to another repository');assert.equal(run.head_repository?.full_name,REPO,'Validate run came from another repository');assert.notEqual(run.head_repository?.fork,true,'Validate run came from a fork');
 assert.equal(run.head_branch,'main','Validate run is not on main');assert.equal(run.event,'push','Validate run was not started by a push');assert.equal(run.path,'.github/workflows/ci.yml','Run is not the Validate workflow');
 assert.equal(run.status,'completed','Validate run has not completed');assert.equal(run.conclusion,'success','Validate run did not succeed');
 assert.match(String(run.id),/^[1-9][0-9]*$/,'Validate run id is malformed');assert.ok(Number.isSafeInteger(run.run_attempt)&&run.run_attempt>0,'Validate run attempt is malformed');
 assert.equal(jobs.total_count,jobs.jobs?.length,'Incomplete CI job metadata');
 for(const name of ['static-checks / build','static-checks / runtime','static-checks / qualification']){
  const selected=jobs.jobs.filter(j=>j.name===name);assert.equal(selected.length,1,`Expected exactly one "${name}" job`);const job=selected[0];
  assert.equal(job.head_sha,head,`"${name}" ran on another commit`);assert.equal(job.run_attempt,run.run_attempt,`"${name}" is from another attempt`);assert.equal(job.status,'completed',`"${name}" has not completed`);assert.equal(job.conclusion,'success',`"${name}" did not succeed`);
 }
 assert.equal(artifacts.total_count,artifacts.artifacts?.length,'Incomplete CI artifact metadata');
 const name=`jarvis-${head}-${run.id}-${run.run_attempt}`,files=artifacts.artifacts.filter(a=>a.name===name);
 assert.equal(files.length,1,`Expected exactly one artifact named ${name}`);assert.equal(files[0].expired,false,`Artifact ${name} has expired`);assert.match(files[0].digest,/^sha256:[a-f0-9]{64}$/,`Artifact ${name} has no sha256 digest`);
 assert.ok(Number.isSafeInteger(files[0].id)&&files[0].id>0,`Artifact ${name} id is malformed`);
 return {runId:String(run.id),attempt:String(run.run_attempt),name,artifactId:String(files[0].id),digest:files[0].digest};
}
export async function findValidation(head,{get}){
 assert.match(head,/^[a-f0-9]{40}$/,'The commit must be a full 40-character lowercase SHA');
 const page=await get('/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&head_sha='+head+'&per_page=20');
 assert.ok(Array.isArray(page.workflow_runs));
 const run=page.workflow_runs.find(r=>r.head_sha===head);assert.ok(run,'Wait for successful main Validate before publication');
 const [jobs,artifacts]=await Promise.all([get(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`),get(`/actions/runs/${run.id}/artifacts?per_page=100`)]);
 return checkedValidation(run,head,jobs,artifacts);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  assert.equal(process.env.GITHUB_REF,'refs/heads/main','Publication must be dispatched from main');
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();checkedReviewedCommit(process.env.EXPECTED_COMMIT,head,process.env.GITHUB_SHA);
  const proof=await findValidation(head,{get:async path=>{
   const response=await fetch(`https://api.github.com/repos/${REPO}${path}`,{method:'GET',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(30000)});
   assert.equal(response.status,200,`Main CI evidence unavailable: HTTP ${response.status} for ${path.split('?')[0]}`);return response.json();
  }});
  await writeFile(process.env.GITHUB_OUTPUT,`run_id=${proof.runId}\nattempt=${proof.attempt}\nartifact_name=${proof.name}\n`,{flag:'a'});
  console.log(`Verified successful main validation ${proof.runId}, attempt ${proof.attempt}, artifact ${proof.artifactId}.`);
 }catch(error){console.error(`Publication requires the exact successful main Validate artifact. No provider changes attempted.\nReason: ${error?.message??error}`);process.exitCode=1;}
}
