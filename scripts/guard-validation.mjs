// Reuse the successful main CI artifact; never start another qualification or
// accept a PR/fork artifact as production evidence.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkedReviewedCommit} from './publish-daily-board.mjs';
const REPO='braydenparker000/Missionarytube-';
export function checkedValidation(run,head,jobs,artifacts){
 assert.match(head,/^[a-f0-9]{40}$/);assert.equal(run.head_sha,head);
 assert.equal(run.repository?.full_name,REPO);assert.equal(run.head_repository?.full_name,REPO);assert.notEqual(run.head_repository?.fork,true);
 assert.equal(run.head_branch,'main');assert.equal(run.event,'push');assert.equal(run.path,'.github/workflows/ci.yml');
 assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
 assert.match(String(run.id),/^[1-9][0-9]*$/);assert.ok(Number.isSafeInteger(run.run_attempt)&&run.run_attempt>0);
 assert.equal(jobs.total_count,jobs.jobs?.length,'Incomplete CI job metadata');
 for(const name of ['static-checks / build','static-checks / runtime','static-checks / qualification']){
  const selected=jobs.jobs.filter(j=>j.name===name);assert.equal(selected.length,1);const job=selected[0];
  assert.equal(job.head_sha,head);assert.equal(job.run_attempt,run.run_attempt);assert.equal(job.status,'completed');assert.equal(job.conclusion,'success');
 }
 assert.equal(artifacts.total_count,artifacts.artifacts?.length,'Incomplete CI artifact metadata');
 const name=`jarvis-${head}-${run.id}-${run.run_attempt}`,files=artifacts.artifacts.filter(a=>a.name===name);
 assert.equal(files.length,1);assert.equal(files[0].expired,false);assert.match(files[0].digest,/^sha256:[a-f0-9]{64}$/);
 assert.ok(Number.isSafeInteger(files[0].id)&&files[0].id>0);
 return {runId:String(run.id),attempt:String(run.run_attempt),name,artifactId:String(files[0].id),digest:files[0].digest};
}
export async function findValidation(head,{get}){
 assert.match(head,/^[a-f0-9]{40}$/);
 const page=await get('/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&head_sha='+head+'&per_page=20');
 assert.ok(Array.isArray(page.workflow_runs));
 const run=page.workflow_runs.find(r=>r.head_sha===head);assert.ok(run,'Wait for successful main Validate before publication');
 const [jobs,artifacts]=await Promise.all([get(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`),get(`/actions/runs/${run.id}/artifacts?per_page=100`)]);
 return checkedValidation(run,head,jobs,artifacts);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  assert.equal(process.env.GITHUB_REF,'refs/heads/main');
  const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();checkedReviewedCommit(process.env.EXPECTED_COMMIT,head,process.env.GITHUB_SHA);
  const proof=await findValidation(head,{get:async path=>{
   const response=await fetch(`https://api.github.com/repos/${REPO}${path}`,{method:'GET',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(30000)});
   assert.equal(response.status,200,'Main CI evidence unavailable');return response.json();
  }});
  await writeFile(process.env.GITHUB_OUTPUT,`run_id=${proof.runId}\nattempt=${proof.attempt}\nartifact_name=${proof.name}\n`,{flag:'a'});
  console.log(`Verified successful main validation ${proof.runId}, attempt ${proof.attempt}, artifact ${proof.artifactId}.`);
 }catch{console.error('Publication requires the exact successful main Validate artifact. No provider changes attempted.');process.exitCode=1;}
}
