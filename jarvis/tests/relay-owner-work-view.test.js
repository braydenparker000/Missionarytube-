import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture, deferred, SITE, WORKER, OWNER_KEY} from './helpers/relay-conversation-browser-fixture.js';
import {createRelayOwnerApi} from '../public/assets/relay-owner-api.js';
import {createRelayOwnerController, ownerWorkStatus, ownerWorkAttention, ownerWorkActivity, ownerWorkPreview, groupOwnerWork} from '../public/assets/relay-owner-ui.js';
import {relayOwnerJobTools} from '../backend/relay-owner-job-tools.js';
import {RELAY_OWNER_INBOX} from '../backend/relay-common.js';

async function fixture(t, intercept=async (_request,response)=>response){
  const h=createConversationFixture(t);t.after(()=>h.close());const auth=await h.oauth(),phone=await h.pair(auth),calls=[];
  const store=new Map([[OWNER_KEY,JSON.stringify({device_token:phone.device_token,device_id:phone.device.id})]]);
  const api=createRelayOwnerApi({origin:WORKER,storage:{getItem:key=>store.get(key)??null,removeItem:key=>store.delete(key)},fetcher:async(url,options)=>{
    const request={path:new URL(url).pathname,url,options};calls.push(request);
    const response=await h.fixture.request(new URL(url).pathname+new URL(url).search,{...options,headers:{...options.headers,Origin:SITE}});
    return intercept(request,response);
  }});
  const create=async(extra={})=>{const payload={id:crypto.randomUUID(),title:'Fictional task',body:'Fictional private work',action_kind:'read_only',...extra};const response=await h.phone('/jobs',payload,phone.device_token);return {payload,response,...await response.json()};};
  const rpc=(name,args)=>h.rpc(auth,name,{inbox_id:RELAY_OWNER_INBOX,...args});
  return {h,auth,phone,api,calls,store,create,rpc};
}

test('owner-entered project and goal survive retry/reload without schema changes or MCP shape drift',async t=>{
  const f=await fixture(t),first=await f.create({project_title:'Fictional garden',goal_title:'Plan the path'});
  assert.equal(first.response.status,201);assert.deepEqual(first.job.presentation,{projectTitle:'Fictional garden',goalTitle:'Plan the path',latestUpdate:null});
  const repeat=await f.h.phone('/jobs',first.payload,f.phone.device_token);assert.equal(repeat.status,200);assert.equal((await repeat.json()).newWrite,false);
  for(const change of [{project_title:'Other project'},{goal_title:'Other goal'},{project_title:undefined,goal_title:undefined}])assert.equal((await f.h.phone('/jobs',{...first.payload,...change},f.phone.device_token)).status,409);
  const read=await f.api.jobDetail(first.job.id);assert.deepEqual(read.job.presentation,first.job.presentation);
  const mcp=await f.rpc('relay_owner_job_read',{job_id:first.job.id});assert.equal(Object.hasOwn(mcp.job,'presentation'),false);
  const shape=relayOwnerJobTools.find(t=>t.name==='relay_owner_job_read').outputSchema.properties.job.properties;
  assert.deepEqual(Object.keys(mcp.job).sort(),Object.keys(shape).sort(),'Cached strict private MCP job schema remains exact');
  const plain=await f.create();assert.equal(plain.response.status,201);assert.equal(plain.job.presentation.projectTitle,null,'No project is inferred for old-style requests');
  const ordinary=await f.h.phone('/messages',{id:crypto.randomUUID(),body:'A fictional ordinary conversation'},f.phone.device_token);const ordinaryId=(await ordinary.json()).entry.id;
  const history=await f.api.jobDetail(ordinaryId);assert.equal(history.job.actionKind,'unclassified');assert.equal(groupOwnerWork([history.job]).length,0,'Ordinary historical conversations are not invented current tasks');
  const run=crypto.randomUUID();await f.rpc('relay_owner_job_claim',{job_id:first.job.id,run_id:run,event_id:crypto.randomUUID()});
  await f.rpc('relay_owner_job_update',{job_id:first.job.id,run_id:run,event_id:crypto.randomUUID(),stage:'failed',summary:'Fictional source missing.',outcome:'not_started'});
  const retry=await f.h.phone('/jobs/retry',{job_id:first.job.id,id:crypto.randomUUID(),confirm_duplicate_risk:true},f.phone.device_token);assert.equal(retry.status,201);
  const child=(await retry.json()).job;assert.equal(child.presentation.projectTitle,'Fictional garden');assert.equal(child.presentation.goalTitle,'Plan the path');
  const grouped=groupOwnerWork([read.job,child,plain.job]);assert.equal(grouped.length,2);assert.equal(grouped.find(t=>t.job.id===child.id).attempts.length,2);
  const publicState=await (await f.h.fixture.request('/shared/state')).json();assert.equal(JSON.stringify(publicState).includes('Fictional garden'),false);
});

test('malformed organization metadata is rejected before writes while optional labels remain optional',async t=>{
  const f=await fixture(t);
  for(const extra of [{project_title:null},{project_title:''},{project_title:'x'.repeat(121)},{project_title:'bad\nlabel'},{goal_title:'orphan'},{project_title:'Good',goal_title:17},{project_title:'Good',owner:'Muse'}]){
    const before=f.h.rows('SELECT COUNT(*) AS n FROM relay_owner_entries')[0].n;
    assert.equal((await f.create(extra)).response.status,400);assert.equal(f.h.rows('SELECT COUNT(*) AS n FROM relay_owner_entries')[0].n,before);
  }
  assert.equal((await f.create({project_title:'Only a project'})).response.status,201);
});

test('later meaningful progress uses existing change pages, excludes heartbeat and preserves immutable corrected results',async t=>{
  let now=Date.parse('2026-10-09T12:00:00Z');t.mock.method(Date,'now',()=>now);
  const f=await fixture(t),first=await f.create({project_title:'Fictional research',goal_title:'Check sources'});
  for(let n=0;n<51;n++)await f.create({title:'Fictional task '+n});
  let cursor='0',through=null,pages=0,jobs=[];
  do{const page=await f.api.jobChanges(cursor,through);jobs.push(...page.changes.map(c=>c.job));cursor=page.cursor;through=page.nextCursor===null?null:page.through;pages++;if(page.nextCursor===null&&!page.bootstrapPending)break;}while(pages<20);
  assert.ok(pages>1);assert.equal(jobs.length,52);
  const run=crypto.randomUUID();now+=1000;await f.rpc('relay_owner_job_claim',{job_id:first.job.id,run_id:run,event_id:crypto.randomUUID()});
  const progressId=crypto.randomUUID();now+=1000;await f.rpc('relay_owner_job_update',{job_id:first.job.id,run_id:run,event_id:progressId,stage:'running',summary:'Read the fictional source; comparing two entries.'});
  now+=1000;await f.rpc('relay_owner_job_update',{job_id:first.job.id,run_id:run,event_id:crypto.randomUUID(),stage:'running'});
  const changed=await f.api.jobChanges(cursor);assert.equal(changed.changes.length,1);assert.equal(changed.changes[0].job.presentation.latestUpdate.id,progressId);
  assert.equal(ownerWorkStatus(changed.changes[0].job,now).state,'working');
  now+=1000;const reply=await f.rpc('relay_owner_reply',{message_id:first.job.id,body:'Fictional original report: all done.'});
  const unverified=await f.api.jobDetail(first.job.id);assert.equal(ownerWorkStatus(unverified.job,now).state,'blocked');assert.equal(unverified.job.completion,null);
  now+=1000;await f.rpc('relay_owner_job_update',{job_id:first.job.id,run_id:run,event_id:crypto.randomUUID(),stage:'completed',summary:'Verified the fictional requested report.',outcome:'known',expected_reply_id:reply.entry.id,expected_version:1});
  now+=1000;await f.rpc('relay_owner_job_result_correct',{job_id:first.job.id,event_id:crypto.randomUUID(),expected_reply_id:reply.entry.id,expected_version:1,body:'Fictional corrected report.',correction_summary:'Checked the fictional second source.'});
  const final=await f.api.jobDetail(first.job.id);assert.equal(ownerWorkStatus(final.job,now).state,'finished');assert.equal(final.job.result.body,'Fictional original report: all done.');assert.equal(final.job.latestResult.body,'Fictional corrected report.');assert.equal(final.job.completion.resultVersion,1);assert.equal(final.job.resultVersion,2);
  const expired={...changed.changes[0].job,execution:{...changed.changes[0].job.execution,leaseExpiresAt:new Date(now-1).toISOString()}};assert.equal(ownerWorkStatus(expired,now).state,'blocked');
});

test('forged public updates cannot enter private presentation or invent execution',async t=>{
  let mutate=value=>value;const f=await fixture(t,async(request,response)=>request.path.endsWith('/jobs/detail')?Response.json(mutate(await response.json())):response);
  const first=await f.create(),run=crypto.randomUUID();await f.rpc('relay_owner_job_claim',{job_id:first.job.id,run_id:run,event_id:crypto.randomUUID()});
  for(const change of [u=>u.visibility='public',u=>u.author_authenticated=false,u=>u.authentication_source='owner-device-session',u=>u.jobId=crypto.randomUUID(),u=>u.kind='public_final',u=>u.summary='x'.repeat(1001)]){
    mutate=value=>{change(value.job.presentation.latestUpdate);return value;};await assert.rejects(f.api.jobDetail(first.job.id),e=>e.kind==='invalid');
  }
  mutate=value=>{value.job.presentation.projectTitle=null;value.job.presentation.goalTitle='Forged orphan goal';return value;};await assert.rejects(f.api.jobDetail(first.job.id),e=>e.kind==='invalid');
  mutate=value=>{delete value.job.presentation;return value;};const older=await f.api.jobDetail(first.job.id);assert.equal(older.job.execution.runId,run);assert.equal(Object.hasOwn(older.job,'presentation'),false);
});

test('lost accepted response retries the original labels and UUID while retaining edited project and goal',async t=>{
  let lose=true;const f=await fixture(t,async(request,response)=>{if(request.path==='/relay/owner/jobs'&&request.options.method==='POST'&&lose){lose=false;throw Error('Fictional lost accepted response');}return response;});
  const controller=createRelayOwnerController({api:f.api,draftStore:{read:()=>'',save:()=>true}});await controller.refresh();controller.setJobMode(true);controller.setJobTitle('Fictional design task');controller.setJobKind('draft');controller.setJobProject('Fictional garden');controller.setJobGoal('Original goal');controller.setDraft('Fictional private draft');await controller.send();assert.equal(controller.snapshot().sendUnconfirmed,true);
  const first=JSON.parse(f.calls.find(c=>c.path==='/relay/owner/jobs'&&c.options.method==='POST').options.body);controller.setJobGoal('Edited goal');await controller.send();assert.equal(f.calls.filter(c=>c.path==='/relay/owner/jobs'&&c.options.method==='POST').length,1);
  await controller.retryUnconfirmed();const writes=f.calls.filter(c=>c.path==='/relay/owner/jobs'&&c.options.method==='POST').map(c=>JSON.parse(c.options.body));assert.deepEqual(writes[1],first);assert.equal(controller.snapshot().jobGoal,'Edited goal');assert.equal(controller.snapshot().draft,'Fictional private draft');assert.equal(f.h.rows('SELECT COUNT(*) AS n FROM relay_owner_jobs')[0].n,1);
});

test('project and goal shortcuts prefill the existing editable composer without requests or submission',async t=>{
  const f=await fixture(t),original=await f.create({project_title:'Fictional garden',goal_title:'Plan the path'});
  const c=createRelayOwnerController({api:f.api,draftStore:{read:()=>'',save:()=>true}});await c.refresh();c.toggleRequests();c.setQuery('fictional garden');c.setWorkFilter('queued');c.setJobKind('draft');
  const before=f.calls.length,jobs=c.snapshot().jobs;
  assert.equal(c.beginTask({projectTitle:'Fictional garden'}),true);assert.equal(c.snapshot().jobGoal,'');c.setJobProject('');
  assert.equal(c.beginTask({projectTitle:' Fictional garden ',goalTitle:' Plan the path '}),true);
  const state=c.snapshot();assert.equal(state.jobMode,true);assert.equal(state.jobProject,'Fictional garden');assert.equal(state.jobGoal,'Plan the path');assert.equal(state.jobTitle,'');assert.equal(state.draft,'');assert.equal(state.jobKind,'draft');
  assert.equal(state.requestsOnly,true);assert.equal(state.query,'fictional garden');assert.equal(state.workFilter,'queued');assert.deepEqual(state.jobs,jobs);assert.equal(f.calls.length,before,'Opening either shortcut creates no read, preflight or write');
  c.setJobProject('Fictional revised project');c.setJobGoal('Fictional revised goal');c.setJobTitle('Fictional new task');c.setDraft('Fictional explicit task submission');await c.send();
  const writes=f.calls.filter(call=>call.path==='/relay/owner/jobs'&&call.options.method==='POST');assert.equal(writes.length,1);
  const payload=JSON.parse(writes[0].options.body);assert.equal(payload.project_title,'Fictional revised project');assert.equal(payload.goal_title,'Fictional revised goal');assert.equal(payload.action_kind,'draft');assert.equal(payload.title,'Fictional new task');
  const saved=c.snapshot().jobs.find(job=>job.id!==original.job.id);assert.equal(saved.stage,'queued');assert.equal(saved.completion,null);assert.equal(saved.result,null);assert.equal(c.snapshot().sendNotice,'Work request saved');assert.equal(c.snapshot().jobProject,'');assert.equal(c.snapshot().jobGoal,'');
});

test('task shortcuts preserve drafts, partial titles, public boundaries and invalid-label state',async t=>{
  const f=await fixture(t),c=createRelayOwnerController({api:f.api,draftStore:{read:()=>'',save:()=>true}});await c.refresh();c.setJobKind('read_only');
  const before=f.calls.length;c.setDraft('Fictional unsent message');assert.equal(c.beginTask({projectTitle:'Fictional garden',goalTitle:'A new goal'}),false);assert.equal(c.snapshot().draft,'Fictional unsent message');assert.equal(c.snapshot().jobMode,false);assert.equal(c.snapshot().jobProject,'');assert.equal(c.snapshot().jobKind,'read_only');
  c.setDraft('');c.setJobTitle('Fictional partial task');assert.equal(c.beginTask({projectTitle:'Fictional garden'}),false);assert.equal(c.snapshot().jobTitle,'Fictional partial task');assert.equal(c.snapshot().jobProject,'');c.setJobTitle('');
  for(const labels of [{projectTitle:'',goalTitle:'Orphan'},{projectTitle:'bad\nlabel'},{projectTitle:'x'.repeat(121)},{projectTitle:17},{projectTitle:'Good',goalTitle:null}])assert.equal(c.beginTask(labels),false);
  c.showPublic();assert.equal(c.beginTask({projectTitle:'Fictional garden'}),false);assert.equal(c.snapshot().jobProject,'');assert.equal(f.calls.length,before);c.showOwner();assert.equal(c.beginTask({projectTitle:'Fictional garden'}),true);assert.equal(c.snapshot().jobKind,'read_only');
});

test('in-flight and uncertain task sends cannot be replaced even after composer text is erased',async t=>{
  const arrived=deferred(),release=deferred();let lose=true;
  const f=await fixture(t,async(request,response)=>{if(request.path==='/relay/owner/jobs'&&request.options.method==='POST'&&lose){arrived.resolve();await release.promise;lose=false;throw Error('Fictional accepted response lost');}return response;});
  const c=createRelayOwnerController({api:f.api,draftStore:{read:()=>'',save:()=>true}});await c.refresh();c.setJobKind('draft');assert.equal(c.beginTask({projectTitle:'Fictional original project',goalTitle:'Fictional original goal'}),true);c.setJobTitle('Fictional original task');c.setDraft('Fictional original body');
  const sending=c.send();await arrived.promise;const inFlight=c.snapshot();assert.equal(inFlight.sending,true);assert.equal(c.beginTask({projectTitle:'Fictional replacement project'}),false);assert.equal(c.snapshot().jobProject,inFlight.jobProject);assert.equal(c.snapshot().draft,inFlight.draft);release.resolve();await sending;
  assert.equal(c.snapshot().sendUnconfirmed,true);const first=JSON.parse(f.calls.find(call=>call.path==='/relay/owner/jobs'&&call.options.method==='POST').options.body);
  c.setDraft('');c.setJobTitle('');c.setJobProject('');c.setJobGoal('');c.setJobMode(false);await c.refresh();assert.equal(c.snapshot().error,'');const before=f.calls.length;
  assert.equal(c.beginTask({projectTitle:'Fictional replacement project',goalTitle:'Fictional replacement goal'}),false);assert.equal(c.snapshot().jobProject,'');assert.equal(c.snapshot().jobGoal,'');assert.equal(c.snapshot().jobMode,false);assert.equal(c.snapshot().sendUnconfirmed,true);assert.match(c.snapshot().sendNotice,/Resolve your unconfirmed send/);assert.equal(f.calls.length,before);
  await c.retryUnconfirmed();const writes=f.calls.filter(call=>call.path==='/relay/owner/jobs'&&call.options.method==='POST').map(call=>JSON.parse(call.options.body));assert.equal(writes.length,2);assert.deepEqual(writes[1],first);assert.equal(f.h.rows('SELECT COUNT(*) AS n FROM relay_owner_jobs')[0].n,1);assert.equal(c.snapshot().draft,'');assert.equal(c.beginTask({projectTitle:'Fictional replacement project'}),true,'Only resolving the original send permits new prefills');
});


test('current work search and status filters stay private and perform no requests',async t=>{
  const f=await fixture(t),first=await f.create({title:'Compare materials',project_title:'Fictional garden',goal_title:'Plan a path'}),second=await f.create({title:'Prepare notes'});
  const run=crypto.randomUUID();await f.rpc('relay_owner_job_claim',{job_id:first.job.id,run_id:run,event_id:crypto.randomUUID()});
  await f.rpc('relay_owner_job_update',{job_id:first.job.id,run_id:run,event_id:crypto.randomUUID(),stage:'running',summary:'Checking two fictional measurements.'});
  const controller=createRelayOwnerController({api:f.api,draftStore:{read:()=>'',save:()=>true}});await controller.refresh();controller.toggleRequests();
  const reads=f.calls.length,select=()=>{const state=controller.snapshot();return groupOwnerWork(state.jobs,{query:state.query,filter:state.workFilter});};
  for(const query of ['materials',' GARDEN ','path','measurements']){controller.setQuery(query);assert.equal(controller.snapshot().requestsOnly,true);assert.deepEqual(select().map(t=>t.job.id),[first.job.id]);}
  controller.setWorkFilter('queued');assert.equal(select().length,0);controller.setQuery('');assert.deepEqual(select().map(t=>t.job.id),[second.job.id]);
  controller.setWorkFilter('working');assert.deepEqual(select().map(t=>t.job.id),[first.job.id]);controller.setWorkFilter('invalid');assert.equal(controller.snapshot().workFilter,'working');
  controller.setWorkFilter('all');controller.setQuery('no fictional match');assert.equal(select().length,0);assert.equal(f.calls.length,reads,'Search and filtering use already loaded records only');
  controller.toggleRequests();controller.setQuery('private work');assert.equal(controller.snapshot().requestsOnly,false,'Message search remains in the message context');
  assert.equal(f.store.has('jarvis.relay.work-filter'),false);
});


test('attention keeps owner input, unknown execution, failure, pending cancellation and unverified completion distinct',()=>{
  const now=Date.parse('2026-10-09T12:00:00Z'),base={title:'Fictional task',body:'Fictional scope',actionKind:'read_only',attempt:1,updatedAt:new Date(now).toISOString()};
  const stages=[{stage:'waiting_for_owner'},{stage:'running',execution:{leaseExpiresAt:new Date(now-1).toISOString()}},{stage:'failed',failure:{message:'Fictional failure'}},{stage:'running',cancelRequested:true},{stage:'outcome_unknown',result:{body:'Fictional acknowledgement'}},{stage:'running',execution:{leaseExpiresAt:new Date(now+1000).toISOString()}},{stage:'completed',completion:{createdAt:new Date(now).toISOString()},result:{body:'Fictional result'}},{stage:'cancelled'}];
  const jobs=stages.map((fields,i)=>({...base,...fields,id:'task-'+i,rootJobId:'root-'+i,sequence:i+1}));
  // A prior failed attempt is history, not an additional current attention item.
  jobs[5].attempt=2;jobs.push({...jobs[5],id:'old-working-root',attempt:1,stage:'failed'});
  const tasks=groupOwnerWork(jobs,{now}),summary=ownerWorkAttention(tasks);assert.deepEqual(summary.map(item=>item.count),[1,1,1,1,1]);
  for(const item of summary){const matching=groupOwnerWork(jobs,{filter:item.reason,now});assert.equal(matching.length,1);assert.equal(matching[0].status.attention,item.reason);}
  assert.equal(groupOwnerWork(jobs,{filter:'blocked',now}).length,5);assert.equal(ownerWorkStatus(jobs[6],now).attention,null);assert.equal(ownerWorkStatus(jobs[7],now).attention,null);
  assert.equal(ownerWorkStatus({...jobs[1],execution:null},now).attention,'execution_unknown');assert.equal(ownerWorkStatus({...jobs[1],execution:{leaseExpiresAt:'invalid'}},now).attention,'execution_unknown');
  assert.equal(ownerWorkStatus({...jobs[0],cancelRequested:true},now).attention,'cancellation_pending');
});


test('closed work previews and ordering use meaningful saved activity instead of heartbeats',()=>{
  const earlier='2026-10-09T12:00:00.000Z',later='2026-10-09T12:00:01.000Z',heartbeat='2026-10-09T12:05:00.000Z',now=Date.parse(later);
  const first={id:'first',rootJobId:'first',attempt:1,sequence:1,title:'Fictional work',actionKind:'read_only',createdAt:earlier,updatedAt:earlier,stage:'running',execution:{leaseExpiresAt:'2026-10-09T12:10:00.000Z'},presentation:{latestUpdate:{kind:'running',summary:'Checked two fictional notes.',createdAt:earlier}}};
  const second={...first,id:'second',rootJobId:'second',sequence:2,presentation:{latestUpdate:{kind:'running',summary:'A later fictional note.',createdAt:later}}};
  assert.equal(ownerWorkPreview(first,ownerWorkStatus(first,now)),'Checked two fictional notes.');assert.equal(ownerWorkActivity(first),earlier);
  const renewed={...first,updatedAt:heartbeat,execution:{...first.execution,acknowledgedAt:heartbeat}};
  assert.equal(ownerWorkActivity(renewed),earlier);assert.deepEqual(groupOwnerWork([renewed,second],{now}).map(task=>task.job.id),['second','first']);
  const onlyHeartbeat={...renewed,presentation:{latestUpdate:{kind:'running',summary:'Authenticated execution progress acknowledged.',createdAt:heartbeat}}};
  assert.equal(ownerWorkActivity(onlyHeartbeat),earlier);assert.equal(ownerWorkPreview(onlyHeartbeat,ownerWorkStatus(onlyHeartbeat,now)),'Execution acknowledged; awaiting a progress update.');
  assert.match(ownerWorkPreview({...first,stage:'waiting_for_owner'},ownerWorkStatus({...first,stage:'waiting_for_owner'},now)),/Checked two fictional notes/);
  assert.match(ownerWorkPreview({...first,cancelRequested:true}),/not been confirmed stopped/);
  assert.match(ownerWorkPreview({...first,stage:'outcome_unknown',result:{body:'Fictional reply'}}),/completion is still unverified/);
  const corrected={...first,stage:'completed',completion:{createdAt:later,summary:'Fictional completion.'},latestResult:{createdAt:heartbeat,correctionSummary:'Checked the fictional second source.'},presentation:{latestUpdate:{kind:'result_corrected',createdAt:heartbeat,summary:'Correction saved.'}}};
  assert.equal(ownerWorkActivity(corrected),heartbeat);assert.equal(ownerWorkPreview(corrected),'Checked the fictional second source.');
});
