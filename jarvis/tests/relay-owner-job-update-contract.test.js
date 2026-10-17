import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture} from './helpers/relay-conversation-browser-fixture.js';
import {RELAY_OWNER_INBOX} from '../backend/relay-common.js';
import {RELAY_OWNER_JOB_LEASE_MS} from '../backend/relay-owner-jobs.js';

// All grants, requests, results and executions are fictional. Calls traverse
// the actual MCP HTTP endpoint and SQLite transactions without live access.
async function setup(t) {
  let now=1760000000000;
  t.mock.method(Date,'now',()=>now);
  const h=createConversationFixture(t);t.after(()=>h.close());
  const owner=await h.oauth(),phone=await h.pair(owner,'Synthetic update contract phone');
  const args=input=>({inbox_id:RELAY_OWNER_INBOX,...input});
  const call=(input,auth=owner)=>h.rpc(auth,'relay_owner_job_update',args(input));
  const response=(input,auth=owner)=>h.rpcResponse(auth,'tools/call',{name:'relay_owner_job_update',arguments:input});
  const create=async()=>{
    const r=await h.phone('/jobs',{id:crypto.randomUUID(),title:'Synthetic update contract',body:'Inspect fictional records only.',action_kind:'read_only'},phone.device_token);
    assert.equal(r.status,201);return (await r.json()).job;
  };
  const claim=async job=>{
    const run_id=crypto.randomUUID();
    await h.rpc(owner,'relay_owner_job_claim',args({job_id:job.id,run_id,event_id:crypto.randomUUID()}));
    return {job_id:job.id,run_id};
  };
  const snapshot=()=>Object.fromEntries(['relay_owner_entries','relay_owner_jobs','relay_owner_job_events','relay_owner_job_result_corrections'].map(table=>[table,h.rows('SELECT * FROM '+table+' ORDER BY rowid')]));
  return {h,owner,phone,args,call,response,create,claim,snapshot,advance(ms=1000){now+=ms;}};
}

async function rejectedWithoutWrite(s,input,auth=s.owner) {
  const before=s.snapshot(),r=await s.response(input,auth),data=await r.json();
  assert.ok(data.error || data.result?.isError,'invalid invocation must not be accepted');
  assert.deepEqual(s.snapshot(),before,'rejection cannot change private entries, state, events or result versions');
  return data;
}

test('job update discovery exposes one complete flat object including every common argument',async t=>{
  const s=await setup(t),r=await s.h.rpcResponse(s.owner,'tools/list'),catalog=await r.json();
  const tool=catalog.result.tools.find(tool=>tool.name==='relay_owner_job_update'),schema=tool.inputSchema;
  assert.equal(schema.type,'object');assert.equal(schema.additionalProperties,false);
  assert.equal(schema.oneOf,undefined,'a top-level branch union hides common root properties in the observed host declaration');
  assert.equal(schema.anyOf,undefined);assert.equal(schema.allOf,undefined);
  assert.deepEqual(Object.keys(schema.properties).sort(),['event_id','expected_reply_id','expected_version','inbox_id','job_id','outcome','run_id','stage','summary']);
  assert.deepEqual(schema.required,['inbox_id','job_id','event_id','stage']);
  assert.deepEqual(schema.properties.stage.enum,['running','waiting_for_owner','completed','failed','cancelled']);
  assert.equal(schema.properties.inbox_id.const,RELAY_OWNER_INBOX);
  for(const key of ['job_id','event_id','run_id','expected_reply_id'])assert.equal(schema.properties[key].format,'uuid');
  assert.equal(schema.properties.expected_version.minimum,1);assert.equal(schema.properties.expected_version.maximum,5);
});

test('full MCP update arguments preserve running, result availability and explicit idempotent completion',async t=>{
  const s=await setup(t),job=await s.create(),claim=await s.claim(job);
  for(const summary of [undefined,'Synthetic execution is inspecting fixture records.']) {
    s.advance();
    const input={...claim,event_id:crypto.randomUUID(),stage:'running',...(summary?{summary}:{})};
    const progress=await s.call(input);assert.equal(progress.newWrite,true);assert.equal(progress.job.stage,'running');
    const replay=await s.call(input);assert.equal(replay.newWrite,false);
    assert.equal(replay.job.execution.leaseExpiresAt,progress.job.execution.leaseExpiresAt);
  }
  const saved=await s.h.rpc(s.owner,'relay_owner_reply',s.args({message_id:job.id,body:'Synthetic fixture inspection result.'}));
  const read=await s.h.rpc(s.owner,'relay_owner_job_read',s.args({job_id:job.id}));
  assert.equal(read.job.stage,'outcome_unknown');assert.equal(read.job.completion,null);
  const input={...claim,event_id:crypto.randomUUID(),stage:'completed',summary:'Synthetic fixture inspection finished.',outcome:'known',expected_reply_id:saved.entry.id,expected_version:1};
  const completed=await s.call(input);assert.equal(completed.newWrite,true);assert.equal(completed.job.stage,'completed');
  assert.equal(completed.job.completion.runId,claim.run_id);assert.equal(completed.job.completion.replyId,saved.entry.id);
  assert.equal(completed.job.completion.resultVersion,1);
  const before=s.snapshot(),again=await s.call(input);assert.equal(again.newWrite,false);assert.deepEqual(s.snapshot(),before);
  await rejectedWithoutWrite(s,s.args({...input,summary:'Synthetic conflicting event payload.'}));
});

test('argument-shape failures remain distinguishable from missing targets and grant/run conflicts',async t=>{
  const s=await setup(t),job=await s.create(),claim=await s.claim(job),foreign=await s.h.oauth();
  const malformed=await rejectedWithoutWrite(s,{stage:'running'});
  assert.deepEqual(malformed.error,{code:-32602,message:'Invalid arguments'});
  const progress=s.args({...claim,event_id:crypto.randomUUID(),stage:'running'});
  for(const [input,auth] of [[{...progress,run_id:crypto.randomUUID()},s.owner],[progress,foreign]]) {
    const rejected=await rejectedWithoutWrite(s,input,auth);
    assert.deepEqual(rejected.error,{code:-32602,message:'Matching authenticated execution lease required',data:{status:409}});
  }
  const missing=await rejectedWithoutWrite(s,{...progress,job_id:crypto.randomUUID()});
  assert.deepEqual(missing.error,{code:-32602,message:'Original private request not found',data:{status:404}});
  const saved=await s.h.rpc(s.owner,'relay_owner_reply',s.args({message_id:job.id,body:'Synthetic result for grant/run diagnostics.'}));
  const complete=s.args({...claim,event_id:crypto.randomUUID(),stage:'completed',summary:'Synthetic completion.',outcome:'known',expected_reply_id:saved.entry.id,expected_version:1});
  for(const [input,auth] of [[{...complete,run_id:crypto.randomUUID()},s.owner],[complete,foreign]]) {
    const rejected=await rejectedWithoutWrite(s,input,auth);
    assert.deepEqual(rejected.error,{code:-32602,message:'Matching authenticated execution lease required',data:{status:409}});
  }
  s.advance(RELAY_OWNER_JOB_LEASE_MS+1);
  const accepted=await s.call(complete);assert.equal(accepted.job.stage,'completed');
  assert.equal(accepted.job.completion.runId,claim.run_id);
});

test('stage-specific required, forbidden and association fields stay enforced at the MCP server',async t=>{
  const s=await setup(t),job=await s.create(),claim=await s.claim(job);
  const saved=await s.h.rpc(s.owner,'relay_owner_reply',s.args({message_id:job.id,body:'Synthetic result for input validation.'}));
  const complete=s.args({...claim,event_id:crypto.randomUUID(),stage:'completed',summary:'Synthetic completion.',outcome:'known',expected_reply_id:saved.entry.id,expected_version:1});
  const cases=[
    ['missing inbox',(({inbox_id,...rest})=>rest)(complete)],
    ['missing job',(({job_id,...rest})=>rest)(complete)],
    ['missing event',(({event_id,...rest})=>rest)(complete)],
    ['missing stage',(({stage,...rest})=>rest)(complete)],
    ['unknown argument',{...complete,unexpected:true}],
    ['invalid stage',{...complete,stage:'queued'}],
    ['missing completion run',{...complete,run_id:undefined}],
    ['missing completion summary',{...complete,summary:undefined}],
    ['blank summary',{...complete,summary:'   '}],
    ['oversized summary',{...complete,summary:'x'.repeat(1001)}],
    ['missing completion outcome',{...complete,outcome:undefined}],
    ['unknown completion outcome',{...complete,outcome:'unknown'}],
    ['not-started completion outcome',{...complete,outcome:'not_started'}],
    ['missing reply association',{...complete,expected_reply_id:undefined}],
    ['missing version',{...complete,expected_version:undefined}],
    ['fractional version',{...complete,expected_version:1.5}],
    ['zero version',{...complete,expected_version:0}],
    ['too-large version',{...complete,expected_version:6}],
    ['reply reused as event',{...complete,event_id:saved.entry.id}],
    ['stale result version',{...complete,expected_version:2}],
    ['wrong original reply',{...complete,expected_reply_id:crypto.randomUUID()}],
    ['wrong execution run',{...complete,run_id:crypto.randomUUID()}],
  ];
  const progress=s.args({...claim,event_id:crypto.randomUUID(),stage:'running'});
  cases.push(['running needs run',{...progress,run_id:undefined}],['running forbids outcome',{...progress,outcome:'known'}],
    ['running forbids reply association',{...progress,expected_reply_id:saved.entry.id}],['running forbids version',{...progress,expected_version:1}]);
  for(const stage of ['waiting_for_owner','failed']) {
    const input=s.args({...claim,event_id:crypto.randomUUID(),stage,summary:'Synthetic blocker.',outcome:'unknown'});
    cases.push([stage+' needs run',{...input,run_id:undefined}],[stage+' needs summary',{...input,summary:undefined}],
      [stage+' needs outcome',{...input,outcome:undefined}],[stage+' forbids reply association',{...input,expected_reply_id:saved.entry.id}],
      [stage+' forbids version',{...input,expected_version:1}]);
  }
  for(const [name,input] of cases)await t.test(name,()=>rejectedWithoutWrite(s,input));
  const foreign=await s.h.oauth();await rejectedWithoutWrite(s,complete,foreign);
});

test('waiting, failure and cancellation keep their outcome, ownership and stopped-execution rules',async t=>{
  const s=await setup(t);
  for(const stage of ['waiting_for_owner','failed'])for(const outcome of ['not_started','known','unknown']) {
    const job=await s.create(),claim=await s.claim(job);
    const accepted=await s.call({...claim,event_id:crypto.randomUUID(),stage,outcome,summary:'Synthetic bounded execution attestation.'});
    assert.equal(accepted.job.stage,stage);
    await rejectedWithoutWrite(s,s.args({...claim,event_id:crypto.randomUUID(),stage:'running'}));
  }
  const queued=await s.create();
  const cancel=await s.h.phone('/jobs/cancel',{job_id:queued.id},s.phone.device_token);assert.equal(cancel.status,201);
  const cancelled=await s.call({job_id:queued.id,event_id:crypto.randomUUID(),stage:'cancelled',summary:'Synthetic execution never started.',outcome:'not_started'});
  assert.equal(cancelled.job.stage,'cancelled');
  const job=await s.create(),claim=await s.claim(job),foreign=await s.h.oauth();
  const stop=s.args({...claim,event_id:crypto.randomUUID(),stage:'cancelled',summary:'Synthetic execution stopped.',outcome:'known'});
  await rejectedWithoutWrite(s,stop);
  assert.equal((await s.h.phone('/jobs/cancel',{job_id:job.id},s.phone.device_token)).status,201);
  await rejectedWithoutWrite(s,{...stop,outcome:'unknown'});
  await rejectedWithoutWrite(s,{...stop,run_id:undefined});
  await rejectedWithoutWrite(s,stop,foreign);
  await rejectedWithoutWrite(s,s.args({...claim,event_id:crypto.randomUUID(),stage:'running'}));
  s.advance(RELAY_OWNER_JOB_LEASE_MS+1);
  const accepted=await s.call(stop);assert.equal(accepted.job.stage,'cancelled');assert.equal(accepted.job.cancelRequested,true);
});
