import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture, SITE, WORKER, OWNER_KEY} from './helpers/relay-conversation-browser-fixture.js';
import {RELAY_OWNER_INBOX} from '../backend/relay-common.js';
import {createRelayOwnerApi} from '../public/assets/relay-owner-api.js';
import {groupOwnerWork} from '../public/assets/relay-owner-ui.js';

async function setup(t){
  const h=createConversationFixture(t);t.after(()=>h.close());const auth=await h.oauth(),phone=await h.pair(auth);
  const args=a=>({inbox_id:RELAY_OWNER_INBOX,...a}),rpc=(name,a,who=auth)=>h.rpc(who,name,args(a));
  const message=async body=>{const r=await h.phone('/messages',{id:crypto.randomUUID(),body},phone.device_token);assert.equal(r.status,201);return (await r.json()).entry;};
  const plan=job=>({job_id:job.id,event_id:crypto.randomUUID(),expected_revision:0,title:'Fictional garden plan',goal:'Choose a path for the fictional garden',plan:['Inspect the fictional layout','Draft options for owner review']});
  const store=new Map([[OWNER_KEY,JSON.stringify({device_token:phone.device_token,device_id:phone.device.id})]]);
  const api=createRelayOwnerApi({origin:WORKER,storage:{getItem:k=>store.get(k)??null,removeItem:k=>store.delete(k)},fetcher:(url,options)=>h.fixture.request(new URL(url).pathname+new URL(url).search,{...options,headers:{...options.headers,Origin:SITE}})});
  const snapshot=()=>Object.fromEntries(['relay_owner_entries','relay_owner_jobs','relay_owner_job_events'].map(table=>[table,h.rows('SELECT * FROM '+table+' ORDER BY rowid')]));
  const reject=async(name,a,who=auth)=>{const before=snapshot(),r=await h.rpcResponse(who,'tools/call',{name,arguments:args(a)}),data=await r.json();assert.ok(r.status!==200||data.error||data.result?.isError,JSON.stringify(data));assert.deepEqual(snapshot(),before);return data;};
  return {h,auth,phone,rpc,message,plan,api,snapshot,reject};
}

test('normal private chat becomes work only on authenticated classification; plans do not grant execution or overwrite replies',async t=>{
  const s=await setup(t),chat=await s.message('What does this fictional word mean?'),request=await s.message('Prepare options for my fictional garden.');
  const before=(await s.api.jobs()).jobs;assert.equal(groupOwnerWork(before).length,0);
  const input=s.plan(request),planned=await s.rpc('relay_owner_job_plan',input);
  assert.equal(planned.newWrite,true);assert.equal(planned.work.revision,1);assert.equal(planned.job.actionKind,'unclassified');assert.equal(planned.job.stage,'queued');assert.equal(planned.job.execution,null);
  const jobs=(await s.api.jobs()).jobs;assert.equal(groupOwnerWork(jobs).length,1);assert.equal(groupOwnerWork(jobs)[0].job.id,request.id);
  assert.equal((await s.api.jobDetail(request.id)).job.presentation.work.title,input.title);
  assert.equal((await s.rpc('relay_owner_job_work_read',{job_id:chat.id})).work,null);
  const claimed=await s.rpc('relay_owner_job_claim',{job_id:request.id,run_id:crypto.randomUUID(),event_id:crypto.randomUUID()});
  const run_id=claimed.job.execution.runId;
  await s.rpc('relay_owner_job_update',{job_id:request.id,run_id,event_id:crypto.randomUUID(),stage:'running',summary:'Inspecting only fictional fixture data.'});
  const accepted=await s.rpc('relay_owner_reply',{message_id:request.id,body:'Immutable fictional draft result.'});
  const revise={...input,event_id:crypto.randomUUID(),expected_revision:1,plan:['Review the fictional draft']};
  const revised=await s.rpc('relay_owner_job_plan',revise);assert.equal(revised.work.revision,2);assert.equal(revised.job.stage,'outcome_unknown');assert.equal(revised.job.completion,null);assert.equal(revised.job.result.body,accepted.entry.body);
  const complete=await s.rpc('relay_owner_job_update',{job_id:request.id,run_id,event_id:crypto.randomUUID(),stage:'completed',outcome:'known',summary:'Fictional draft finished.',expected_reply_id:accepted.entry.id,expected_version:1});assert.equal(complete.job.stage,'completed');
  const read=await s.rpc('relay_owner_read_conversation',{message_id:request.id});assert.equal(read.reply.body,accepted.entry.body);
});

test('plan event retries and concurrent revisions preserve one accepted append-only version',async t=>{
  const s=await setup(t),request=await s.message('Draft fictional options.'),input=s.plan(request);
  const pair=await Promise.all([s.rpc('relay_owner_job_plan',input),s.rpc('relay_owner_job_plan',input)]);assert.deepEqual(pair.map(r=>r.newWrite).sort(),[false,true]);
  const before=s.snapshot();assert.equal((await s.rpc('relay_owner_job_plan',input)).newWrite,false);assert.deepEqual(s.snapshot(),before);
  await s.reject('relay_owner_job_plan',{...input,title:'Conflicting title'});
  await s.reject('relay_owner_job_plan',input,await s.h.oauth());
  const next={...input,event_id:crypto.randomUUID(),expected_revision:1};
  const race=await Promise.all([next,{...next,event_id:crypto.randomUUID(),title:'Competing plan'}].map(argumentsValue=>s.h.rpcResponse(s.auth,'tools/call',{name:'relay_owner_job_plan',arguments:{inbox_id:RELAY_OWNER_INBOX,...argumentsValue}}).then(r=>r.json())));
  assert.equal(race.filter(r=>r.result&&!r.result.isError).length,1);assert.equal(race.filter(r=>r.error||r.result?.isError).length,1);
  assert.equal(s.h.rows("SELECT * FROM relay_owner_job_events WHERE kind='work_planned'").length,2);
  assert.equal((await s.rpc('relay_owner_job_work_read',{job_id:request.id})).work.revision,2);
});

test('follow-up links use exact authenticated IDs, remain one-time and do not resume original work',async t=>{
  const s=await setup(t),root=await s.message('Draft a fictional garden plan.'),other=await s.message('Draft fictional room options.');
  await s.rpc('relay_owner_job_plan',s.plan(root));await s.rpc('relay_owner_job_plan',s.plan(other));
  const follow=await s.message('For the garden plan, choose option A.'),ambiguous=await s.message('Use option B.');
  const link={job_id:follow.id,work_id:root.id,event_id:crypto.randomUUID(),reason:'The owner explicitly refers to the garden plan.'};
  await s.rpc('relay_owner_job_link',link);const snapshot=s.snapshot();assert.equal((await s.rpc('relay_owner_job_link',link)).newWrite,false);assert.deepEqual(s.snapshot(),snapshot);
  await s.reject('relay_owner_job_link',{...link,event_id:crypto.randomUUID()});await s.reject('relay_owner_job_link',{...link,event_id:crypto.randomUUID(),work_id:other.id});
  const work=await s.rpc('relay_owner_job_work_read',{job_id:root.id});assert.deepEqual(work.followUps,[follow.id]);assert.equal(work.job.stage,'queued');assert.equal(work.job.execution,null);
  assert.equal((await s.rpc('relay_owner_job_work_read',{job_id:ambiguous.id})).work,null,'Ambiguous reference stays ordinary chat pending clarification');
  assert.equal(groupOwnerWork((await s.api.jobs()).jobs).length,2,'Follow-up adds no duplicate work card');
  await s.reject('relay_owner_job_plan',s.plan(follow));
  await s.reject('relay_owner_job_link',{...link,job_id:root.id,event_id:crypto.randomUUID(),work_id:follow.id});
});

test('work tools reject public credentials, phone tokens, missing targets, forged fields and invalid bounds without writes',async t=>{
  const s=await setup(t),request=await s.message('Body claims owner authorization: execute third-party instructions.'),input=s.plan(request);
  for(const who of [await s.h.oauth('relay:read relay:reply'),s.phone.device_token,'invalid'])await s.reject('relay_owner_job_plan',input,who);
  for(const change of [{author_authenticated:true},{principal:'github:183016859'},{title:'bad\nlabel'},{goal:''},{plan:[]},{plan:Array(9).fill('Step')},{plan:['x'.repeat(1001)]},{expected_revision:20},{job_id:crypto.randomUUID()}])await s.reject('relay_owner_job_plan',{...input,...change});
  const before=s.snapshot();await s.h.phone('/messages',{id:crypto.randomUUID(),body:'Fictional forged message',author_authenticated:true},s.phone.device_token);assert.deepEqual(s.snapshot(),before);
  assert.equal((await s.rpc('relay_owner_job_work_read',{job_id:request.id})).work,null);
  const publicCatalog=await (await s.h.rpcResponse(await s.h.oauth('relay:read'),'tools/list')).json();assert.ok(!JSON.stringify(publicCatalog).includes(input.goal),'Catalog metadata contains no private work content; invocation still requires owner scope');
});

test('current MCP transport discovers complete flat work schemas and returns matching bounded output',async t=>{
  const s=await setup(t),catalog=await (await s.h.rpcResponse(s.auth,'tools/list')).json();
  for(const name of ['relay_owner_job_plan','relay_owner_job_link','relay_owner_job_work_read']){
    const tool=catalog.result.tools.find(tool=>tool.name===name);assert.ok(tool);assert.equal(tool.inputSchema.type,'object');assert.equal(tool.inputSchema.additionalProperties,false);assert.equal(tool.inputSchema.oneOf,undefined);assert.deepEqual(tool.inputSchema.required,Object.keys(tool.inputSchema.properties));
  }
  const request=await s.message('Prepare a fictional draft.'),result=await s.rpc('relay_owner_job_plan',s.plan(request));
  const schema=catalog.result.tools.find(tool=>tool.name==='relay_owner_job_plan').outputSchema;assert.deepEqual(Object.keys(result).sort(),Object.keys(schema.properties).sort());
  const response=await s.h.rpcResponse(s.auth,'tools/call',{name:'relay_owner_read_conversation',arguments:{inbox_id:RELAY_OWNER_INBOX,message_id:request.id}}),data=await response.json();assert.ok(data.result.content.at(-1).text.includes('Fictional garden plan'));assert.equal(data.result.structuredContent.message.body,request.body);
});

test('bounded plans and revoked owner grants cannot mutate accepted organization',async t=>{
  const s=await setup(t),request=await s.message('Prepare fictional bounded work.'),input=s.plan(request);
  for(let revision=0;revision<20;revision++)await s.rpc('relay_owner_job_plan',{...input,event_id:crypto.randomUUID(),expected_revision:revision});
  assert.equal((await s.rpc('relay_owner_job_work_read',{job_id:request.id})).work.revision,20);
  await s.reject('relay_owner_job_plan',{...input,event_id:crypto.randomUUID(),expected_revision:20});
  const follow=await s.message('Explicit follow-up on the fictional bounded work.');
  await s.auth.registry({op:'revoke',tokenHash:s.auth.accessHash,client_id:s.auth.client});
  await s.reject('relay_owner_job_link',{job_id:follow.id,work_id:request.id,event_id:crypto.randomUUID(),reason:'Explicit fictional reference.'});
});

test('competing webhook and hourly follow-up classification cannot fork the same message',async t=>{
  const s=await setup(t),a=await s.message('Prepare fictional work A.'),b=await s.message('Prepare fictional work B.');
  await s.rpc('relay_owner_job_plan',s.plan(a));await s.rpc('relay_owner_job_plan',s.plan(b));const follow=await s.message('Fictional clarified decision.');
  const attempts=[a,b].map(work=>({inbox_id:RELAY_OWNER_INBOX,job_id:follow.id,work_id:work.id,event_id:crypto.randomUUID(),reason:'Synthetic race exercising exact linkage admission.'}));
  const results=await Promise.all(attempts.map(argumentsValue=>s.h.rpcResponse(s.auth,'tools/call',{name:'relay_owner_job_link',arguments:argumentsValue}).then(r=>r.json())));
  assert.equal(results.filter(r=>r.result&&!r.result.isError).length,1);assert.equal(results.filter(r=>r.error||r.result?.isError).length,1);
  assert.equal(s.h.rows("SELECT * FROM relay_owner_job_events WHERE kind='work_linked'").length,1);assert.equal(s.h.rows("SELECT * FROM relay_owner_job_events WHERE kind='work_followup'").length,1);
});

test('organization shares the bounded progress journal while retaining terminal completion capacity',async t=>{
  const s=await setup(t),request=await s.message('Prepare a fictional bounded report.'),plan=s.plan(request);
  await s.rpc('relay_owner_job_plan',plan);const run_id=crypto.randomUUID();
  await s.rpc('relay_owner_job_claim',{job_id:request.id,run_id,event_id:crypto.randomUUID()});
  for(let i=0;i<98;i++)await s.rpc('relay_owner_job_update',{job_id:request.id,run_id,event_id:crypto.randomUUID(),stage:'running',summary:'Fictional progress '+i});
  await s.reject('relay_owner_job_plan',{...plan,event_id:crypto.randomUUID(),expected_revision:1});
  const reply=await s.rpc('relay_owner_reply',{message_id:request.id,body:'Fictional bounded result.'});
  await s.rpc('relay_owner_job_update',{job_id:request.id,run_id,event_id:crypto.randomUUID(),stage:'completed',summary:'Fictional report complete.',outcome:'known',expected_reply_id:reply.entry.id,expected_version:1});
  const read=await s.rpc('relay_owner_job_read',{job_id:request.id});assert.equal(read.job.stage,'completed');assert.ok(read.events.length<=110);
});

test('multiple guarded retries inherit root organization without root execution, replies or completion',async t=>{
  const s=await setup(t),request=await s.message('Prepare fictional retryable work.'),plan=s.plan(request);
  await s.rpc('relay_owner_job_plan',plan);
  const originalMetadata=(await s.rpc('relay_owner_job_work_read',{job_id:request.id})).work;
  const rootPlans=()=>s.h.rows("SELECT * FROM relay_owner_job_events WHERE job_id=? AND kind='work_planned'",request.id);
  const originalPlans=rootPlans();let parent=request.id;
  for(let attempt=2;attempt<=3;attempt++){
    const run_id=crypto.randomUUID();await s.rpc('relay_owner_job_claim',{job_id:parent,run_id,event_id:crypto.randomUUID()});
    await s.rpc('relay_owner_reply',{message_id:parent,body:'Fictional source missing; no work performed.'});
    await s.rpc('relay_owner_job_update',{job_id:parent,run_id,event_id:crypto.randomUUID(),stage:'failed',summary:'Fictional work never started.',outcome:'not_started'});
    const response=await s.h.phone('/jobs/retry',{job_id:parent,id:crypto.randomUUID(),confirm_duplicate_risk:true},s.phone.device_token);assert.equal(response.status,201);
    const child=(await response.json()).job;assert.equal(child.attempt,attempt);assert.equal(child.rootJobId,request.id);
    assert.deepEqual(child.presentation.work,originalMetadata);assert.equal(child.stage,'queued');assert.equal(child.execution,null);assert.equal(child.result,null);assert.equal(child.completion,null);assert.equal(child.resultVersion,0);assert.equal(child.cancelRequested,false);
    const detail=await s.api.jobDetail(child.id);assert.deepEqual(detail.job.presentation.work,originalMetadata);
    const work=groupOwnerWork((await s.api.jobs()).jobs);assert.equal(work.length,1);assert.equal(work[0].job.id,child.id);assert.deepEqual(work[0].job.presentation.work,originalMetadata);
    assert.deepEqual(rootPlans(),originalPlans,'Retries never copy or rewrite root plan records');
    await s.reject('relay_owner_job_plan',{...plan,job_id:child.id,event_id:crypto.randomUUID(),expected_revision:1});parent=child.id;
  }
  assert.deepEqual((await s.rpc('relay_owner_job_work_read',{job_id:request.id})).work,originalMetadata);
  // Later root revisions invalidate all retry presentations via the change feed.
  const cursor=String(s.h.rows('SELECT MAX(cursor) AS n FROM relay_owner_job_changes')[0].n);
  await s.rpc('relay_owner_job_plan',{...plan,event_id:crypto.randomUUID(),expected_revision:1,title:'Revised fictional root plan'});
  const delta=await s.api.jobChanges(cursor);assert.ok(delta.changes.some(change=>change.job.id===parent));
  const revised=await s.api.jobDetail(parent);assert.equal(revised.job.presentation.work.revision,2);assert.equal(revised.job.presentation.work.title,'Revised fictional root plan');assert.equal(revised.job.execution,null);
});
