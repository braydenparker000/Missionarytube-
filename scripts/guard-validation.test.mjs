import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedValidation,findValidation} from './guard-validation.mjs';
const head='a'.repeat(40),repository={full_name:'braydenparker000/Missionarytube-'};
const fixture=()=>{
 const run={id:12,run_attempt:2,head_sha:head,repository,head_repository:repository,head_branch:'main',event:'push',path:'.github/workflows/ci.yml',status:'completed',conclusion:'success'};
 const jobs={total_count:3,jobs:['build','runtime','qualification'].map(name=>({name:'static-checks / '+name,head_sha:head,run_attempt:2,status:'completed',conclusion:'success'}))};
 const artifacts={total_count:1,artifacts:[{id:34,name:`jarvis-${head}-12-2`,digest:'sha256:'+'b'.repeat(64),expired:false}]};return {run,jobs,artifacts};
};
test('production evidence requires exact successful main jobs and an unexpired digest-bound artifact',()=>{
 const f=fixture();assert.equal(checkedValidation(f.run,head,f.jobs,f.artifacts).runId,'12');
 for(const mutate of [f=>f.run.event='pull_request',f=>f.run.head_branch='feature',f=>f.run.head_repository={full_name:'foreign/repo'},f=>f.run.conclusion='failure',f=>f.run.run_attempt++,f=>f.jobs.jobs[1].conclusion='skipped',f=>f.jobs.total_count++,f=>f.artifacts.total_count++,f=>f.artifacts.artifacts[0].expired=true,f=>f.artifacts.artifacts[0].digest='changed',f=>f.artifacts.artifacts[0].name='another-artifact']){
  const f=fixture();mutate(f);assert.throws(()=>checkedValidation(f.run,head,f.jobs,f.artifacts));
 }
});
test('discovery reads only exact main CI evidence and never substitutes another source or starts a workflow',async()=>{
 const f=fixture(),calls=[];const get=async path=>{calls.push(path);return path.includes('/workflows/')?{workflow_runs:[f.run]}:path.includes('/jobs?')?f.jobs:f.artifacts;};
 assert.equal((await findValidation(head,{get})).artifactId,'34');assert.equal(calls.length,3);assert.ok(calls[0].includes('event=push&status=success&head_sha='+head));
 await assert.rejects(findValidation('c'.repeat(40),{get}),/Wait for successful main Validate/);
});
test('a refusal names the missing evidence',()=>{
 for(const [mutate,reason] of [[f=>f.artifacts.artifacts[0].expired=true,/has expired/],[f=>f.jobs.jobs[2].conclusion='failure',/"static-checks \/ qualification" did not succeed/],[f=>f.run.event='pull_request',/not started by a push/]]){
  const f=fixture();mutate(f);assert.throws(()=>checkedValidation(f.run,head,f.jobs,f.artifacts),reason);
 }
});
test('the publication step prints its reason and changes nothing',async()=>{
 const {execFile}=await import('node:child_process');
 const {stderr,code}=await new Promise(done=>execFile(process.execPath,[new URL('./guard-validation.mjs',import.meta.url).pathname],{env:{...process.env,GITHUB_REF:'refs/heads/main',EXPECTED_COMMIT:'a'.repeat(40)+'.',GITHUB_SHA:'a'.repeat(40)}},(error,stdout,stderr)=>done({stderr,code:error?.code??0})));
 assert.equal(code,1);assert.match(stderr,/No provider changes attempted\.\nReason: A reviewed commit is required.*got "a{40}\."/);
});
