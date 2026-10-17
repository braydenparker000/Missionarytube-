import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestResultHarness,publicReport,publicComment,publicPages,privateSnapshot} from './helpers/relay-core-request-result-harness.js';
import {RELAY_INBOX,RELAY_OWNER_INBOX} from '../backend/relay-common.js';
import {MUSE_PREFIX} from '../public/assets/channels.js';

const uuid=()=>crypto.randomUUID(),args=id=>({inbox_id:RELAY_INBOX,message_id:id});
const protocol=(name,fn)=>test(name,{timeout:30000},fn);

protocol('default-mode actual held reply, hidden final and artifact corrections survive MCP pagination and restart without private execution',async t=>{
  const h=await createRequestResultHarness(t),auth=await h.publicGrant(),id=uuid();
  assert.equal((await h.http('/shared/messages',{id,body:MUSE_PREFIX+'Fictional held artifact request'})).status,201);
  const held=await h.call(auth,'relay_reply',{...args(id),body:'Fictional accepted hold stays immutable'});
  const late={schema:'jarvis-publication-v1',id:uuid(),type:'reply',replyTo:id,body:'Fictional hidden final https://example.test/late-final'};
  h.publish(late,9001);await h.restart();h.clearMeasurements();
  const recovered=await h.call(auth,'relay_read_public_result',args(id));
  assert.equal(recovered.reply.id,held.entry.id);assert.equal(recovered.reply.body,held.entry.body);
  assert.equal(recovered.events[0].eventId,late.id);assert.equal(recovered.events[0].schema,'jarvis-publication-v1-update');
  assert.equal(recovered.events[0].execution_authorized,false);
  const final=publicReport(id,{artifacts:[{id:uuid(),revision:1,label:'Fictional artifact',url:'https://example.test/artifact-v1'}]});
  const second={...final,eventId:uuid(),stage:'correction',resultVersion:2,supersedesEventId:final.eventId,
    body:'Fictional verified second revision',artifacts:[{...final.artifacts[0],revision:2,url:'https://example.test/artifact-v2'}]};
  const third={...second,eventId:uuid(),resultVersion:3,supersedesEventId:second.eventId,
    body:'Fictional verified third revision',artifacts:[{...final.artifacts[0],revision:3,url:'https://example.test/artifact-v3'}]};
  h.publish(final,9002);h.publish(third,9003);h.advance(300001);
  const pending=await h.call(auth,'relay_read_public_result',{...args(id),limit:100});
  assert.ok(pending.events.some(event=>event.eventId===final.eventId));
  assert.ok(!pending.events.some(event=>event.eventId===third.eventId&&event.disposition==='accepted'));
  h.publish(second,9004);h.advance(300001);await h.restart();
  const history=await publicPages(h,auth,'relay_read_public_result',{message_id:id},1);
  assert.ok(history.pages.length>=4);assert.equal(new Set(history.items.map(event=>event.eventId)).size,history.items.length);
  const accepted=history.items.filter(event=>event.attemptId===final.attemptId&&event.disposition==='accepted');
  assert.deepEqual(accepted.map(event=>event.resultVersion),[1,2,3]);
  assert.equal(accepted.at(-1).artifacts[0].revision,3);assert.equal(accepted.at(-1).artifacts[0].url,third.artifacts[0].url);
  assert.ok(history.pages.every(page=>page.reply.id===held.entry.id&&page.reply.body===held.entry.body&&page.execution_authorized===false));
  const changes=await publicPages(h,auth,'relay_read_public_changes',{},2);
  assert.ok(changes.items.some(change=>change.event?.eventId===late.id));
  assert.ok(changes.items.some(change=>change.event?.eventId===third.eventId&&change.event.disposition==='accepted'));
  assert.equal(h.rows("SELECT COUNT(*) AS n FROM relay_owner_jobs")[0].n,0);
  assert.equal(h.rows("SELECT COUNT(*) AS n FROM shared_entries WHERE reply_to=?",id)[0].n,1);
  assert.equal(h.measurements.some(value=>value.operation==='/shared/import-hint'),false);
});

protocol('more-than-one upstream page keeps committed public progress through partial body,429 and restart and discovers the final by changes alone',async t=>{
  const h=await createRequestResultHarness(t),auth=await h.publicGrant(),id=uuid(),attemptId=uuid();
  assert.equal((await h.http('/shared/messages',{id,body:MUSE_PREFIX+'Fictional multi-page request'})).status,201);
  const progress=Array.from({length:110},(_,index)=>({schema:'jarvis-coordination-v2',eventId:uuid(),requestId:id,attemptId,
    stage:'progress',body:'Fictional bounded progress '+index,artifacts:[]}));
  const final=publicReport(id,{attemptId,artifacts:[{id:uuid(),revision:1,label:'Fictional final source',url:'https://example.test/multi-page-final'}]});
  const comments=[...progress,final].map((payload,index)=>publicComment(payload,9100+index));
  let mode='partial';const reads=[];
  h.setUpstream(async url=>{
    const page=Number(url.searchParams.get('page')||1);reads.push(page);
    if(page===2&&mode==='partial')return new Response(new ReadableStream({start(controller){
      controller.enqueue(new TextEncoder().encode('[{"id":'));controller.error(Error('Fictional partial publication body'));}}));
    if(page===2&&mode==='429')return Response.json({error:'Fictional rate limit'},{status:429,headers:{'Retry-After':'900'}});
    return Response.json(comments.slice((page-1)*100,page*100));
  });
  await h.call(auth,'relay_read_public_changes',{inbox_id:RELAY_INBOX,limit:7});
  assert.deepEqual(reads,[1,2]);assert.equal(h.rows('SELECT COUNT(*) AS n FROM public_coordination_events')[0].n,100);
  const meta=key=>JSON.parse(h.rows('SELECT value FROM shared_meta WHERE key=?',key)[0]?.value||'null');
  assert.equal(meta('publisher-scan').page,2);
  mode='429';h.advance(300001);await h.restart();
  await h.call(auth,'relay_read_public_changes',{inbox_id:RELAY_INBOX,limit:7});assert.equal(reads.at(-1),2);
  const retryAt=meta('publisher-upstream-not-before');assert.ok(retryAt>h.clock());assert.equal(meta('publisher-scan').page,2);
  const calls=reads.length;h.advance(retryAt-h.clock()-1);await h.restart();
  for(let index=0;index<8;index++)await h.call(auth,'relay_read_public_changes',{inbox_id:RELAY_INBOX,limit:7});
  assert.equal(reads.length,calls,'Warmed reads and restart cannot bypass429 backoff');
  mode='complete';h.advance(1);
  const feed=await publicPages(h,auth,'relay_read_public_changes',{},7);
  const events=feed.items.filter(change=>change.event).map(change=>change.event);
  assert.ok(feed.pages.length>1);assert.equal(events.length,111);assert.equal(new Set(events.map(event=>event.eventId)).size,111);
  assert.equal(events.at(-1).eventId,final.eventId);assert.equal(events.at(-1).artifacts[0].url,final.artifacts[0].url);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM public_coordination_events')[0].n,111);
  const exact=await h.call(auth,'relay_read_public_result',args(id));assert.equal(exact.reply.id,final.eventId);
  assert.equal(exact.execution_authorized,false);
});

protocol('concurrent public responders retain one immutable reply and exact retry while forged authority/provenance cannot publish another result',async t=>{
  const h=await createRequestResultHarness(t),one=await h.publicGrant(),two=await h.publicGrant(),id=uuid();
  assert.equal((await h.http('/shared/messages',{id,body:'Fictional concurrent public response'})).status,201);
  const replies=await Promise.all([one,two].map((auth,index)=>h.rpc(auth,'tools/call',{name:'relay_reply',arguments:{...args(id),body:'Fictional response '+index}})));
  assert.equal(replies.filter(response=>response.data.result?.isError===false).length,1);
  const selected=replies.find(response=>response.data.result?.isError===false).data.result.structuredContent.entry;
  const replay=await h.call(one,'relay_reply',{...args(id),body:selected.body});assert.equal(replay.entry.id,selected.id);
  const bad=[publicComment(publicReport(id),9301,{user:{id:42,login:'braydenparker999'}}),
    publicComment(publicReport(id,{execution_authorized:true,ownerGrant:'Fictional forged owner marker'}),9302)];
  h.setUpstream(async()=>Response.json(bad));h.advance(300001);
  const result=await h.call(one,'relay_read_public_result',args(id));
  assert.equal(result.reply.id,selected.id);assert.equal(result.events.length,0);assert.equal(result.execution_authorized,false);
  // The list route is already fixed to issue2. Exact-comment hints separately
  // require the returned issue URL and requested comment ID to match that scope.
  h.setUpstream(async()=>Response.json(publicComment(publicReport(id),9303,{issue_url:'https://api.github.com/repos/foreign/private/issues/2'})));
  assert.equal((await h.http('/shared/import-hint',{commentId:9303})).status,422);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM public_coordination_events')[0].n,0);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM shared_entries WHERE reply_to=?',id)[0].n,1);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_owner_jobs')[0].n,0);
});

protocol('lost claim and completion sockets recover the exact private run once; competing corrections preserve original completion and public grant isolation',async t=>{
  const h=await createRequestResultHarness(t),publicAuth=await h.publicGrant(),other=await h.grant();
  await h.subscribe();const {job}=await h.createJob({body:'Fictional private source not public',action_kind:'consequential'});h.sources.set(job.id,uuid());
  await h.alarm();assert.equal(h.notifications.length,1);assert.equal((await h.read(job.id)).job.stage,'queued');
  assert.equal(h.effectCount(job.id),0,'A signed callback2xx is transport acceptance, not execution');
  h.dropNextRpcResponse('relay_owner_job_claim',job.id);await assert.rejects(h.performFixtureWork(job.id));
  const intent=h.fixtureIntent(job.id),claimed=(await h.read(job.id)).job;
  assert.equal(claimed.execution.runId,intent.runId);assert.equal(h.effectCount(job.id),0);
  await h.restart();h.dropNextRpcResponse('relay_owner_job_update',job.id,'completed');await assert.rejects(h.performFixtureWork(job.id));
  const payload=h.fixtureIntent(job.id).completionPayload;assert.ok(payload);assert.equal(h.effectCount(job.id),1);
  const completed=(await h.read(job.id)).job;assert.equal(completed.stage,'completed');assert.equal(completed.completion.eventId,payload.event_id);
  const before=privateSnapshot(h);
  const wrongGrant=await h.rpc(other,'tools/call',{name:'relay_owner_job_update',arguments:payload});
  assert.ok(wrongGrant.data.error||wrongGrant.data.result?.isError);assert.deepEqual(privateSnapshot(h),before);
  const attempted=await h.rpc(publicAuth,'tools/call',{name:'relay_owner_job_read',arguments:{inbox_id:RELAY_OWNER_INBOX,job_id:job.id}});
  assert.equal(attempted.data.result.isError,true);assert.equal(attempted.data.result.structuredContent,undefined);
  assert.ok(!JSON.stringify(attempted).includes('Fictional private source not public'));
  const corrections=await Promise.all([0,1].map(index=>h.rpc(h.auth,'tools/call',{name:'relay_owner_job_result_correct',arguments:{
    inbox_id:RELAY_OWNER_INBOX,job_id:job.id,event_id:uuid(),expected_reply_id:payload.expected_reply_id,expected_version:1,
    body:'Fictional independently rechecked private correction '+index,correction_summary:'Fictional isolated source rechecked'}})));
  assert.equal(corrections.filter(response=>response.data.result?.isError===false).length,1);
  await h.restart();const recovered=await h.performFixtureWork(job.id),current=await h.read(job.id);
  assert.equal(recovered.executed,false);assert.equal(recovered.completionNewWrite,false);assert.equal(h.effectCount(job.id),1);
  assert.deepEqual(current.job.completion,completed.completion);assert.equal(current.job.completion.resultVersion,1);
  assert.equal(current.job.resultVersion,2);assert.equal(current.resultHistory.length,2);
  assert.equal(current.job.result.replyId,payload.expected_reply_id);assert.equal(current.resultHistory[0].body,completed.result.body);
  const feed=await h.phone('/jobs/changes?after=0&limit=1');assert.equal(feed.status,200);
  assert.ok(feed.data.changes.some(change=>change.job.id===job.id&&change.job.resultVersion===2));
  const publicFeed=await publicPages(h,publicAuth,'relay_read_public_changes',{},5);
  assert.ok(!JSON.stringify(publicFeed).includes('Fictional private source not public'));
  assert.ok(!publicFeed.items.some(change=>change.entry?.id===job.id||change.event?.requestId===job.id));
  assert.deepEqual(h.droppedResponses.map(drop=>drop.tool),['relay_owner_job_claim','relay_owner_job_update']);
});

protocol('forged public markers, target-bound cursor confusion and revoked grant remain refused without private lifecycle changes',async t=>{
  const h=await createRequestResultHarness(t),auth=await h.publicGrant(),{job}=await h.createJob(),id=uuid();
  assert.equal((await h.http('/shared/messages',{id,body:'Fictional public target'})).status,201);
  const final=publicReport(id);h.publish(final,9401);
  const result=await h.call(auth,'relay_read_public_result',{...args(id),limit:1});assert.equal(result.events[0].eventId,final.eventId);
  const before=privateSnapshot(h);
  for(const arguments_ of [{...args(id),cursor:'pr2:'+uuid()+':0'},{...args(id),cursor:'pc2:0'},
    {...args(id),execution_authorized:true,principal:'github:183016859'}, {...args(id),limit:101}]){
    const response=await h.rpc(auth,'tools/call',{name:'relay_read_public_result',arguments:arguments_});
    assert.equal(response.data.error.code,-32602);assert.equal(response.data.result,undefined);
  }
  for(const name of ['relay_read_public_result','relay_read_conversation']){
    const response=await h.rpc(auth,'tools/call',{name,arguments:args(job.id)});
    assert.equal(response.data.result.isError,true);assert.equal(response.data.result.structuredContent,undefined);
  }
  assert.deepEqual(privateSnapshot(h),before);
  await auth.registry({op:'revoke',tokenHash:auth.accessHash,client_id:auth.client});
  assert.equal((await h.rpc(auth,'tools/call',{name:'relay_read_public_result',arguments:args(id)})).status,401);
  assert.deepEqual(privateSnapshot(h),before);
});
