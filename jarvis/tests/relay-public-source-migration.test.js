import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture} from './helpers/relay-conversation-browser-fixture.js';
import {syncPublications,publicationSources,takePublicationFetch,publicationSchema,nextPublicationReconciliationAt,publicationReadNeedsWake,DESTINATION_PUBLICATION_ISSUE_ENV,DESTINATION_PUBLICATION_ENABLE_ENV} from '../backend/publications.js';
import {sharedStore} from '../backend/shared.js';

const oldRepo='braydenparker999/jarvis',newRepo='braydenparker000/Missionarytube-';
const oldIssue=`https://api.github.com/repos/${oldRepo}/issues/2`;
const stamp='2026-10-17T10:00:00Z';
const metadata=(h,key)=>JSON.parse(h.rows('SELECT value FROM shared_meta WHERE key=?',key)[0].value);
const publication=(id,title,date,body)=>({schema:'jarvis-publication-v1',id,type:'briefing',title,date,body});
const comment=(repo,issue,id,pub,overrides={})=>({id,user:{id:183016859},issue_url:`https://api.github.com/repos/${repo}/issues/${issue}`,
  body:JSON.stringify(pub),created_at:stamp,updated_at:stamp,...overrides});

test('destination source remains inert until an exact non-reserved issue is configured',()=>{
  assert.deepEqual(publicationSources().map(source=>source.key),[`${oldRepo}#2`]);
  assert.deepEqual(publicationSources({[DESTINATION_PUBLICATION_ISSUE_ENV]:'2'}).map(source=>source.key),[`${oldRepo}#2`]);
  assert.deepEqual(publicationSources({[DESTINATION_PUBLICATION_ISSUE_ENV]:'not-an-issue'}).map(source=>source.key),[`${oldRepo}#2`]);
  assert.deepEqual(publicationSources({[DESTINATION_PUBLICATION_ISSUE_ENV]:'77'}).map(source=>source.key),[`${oldRepo}#2`],'A target alone does not activate the reader');
  assert.deepEqual(publicationSources({[DESTINATION_PUBLICATION_ISSUE_ENV]:'77',[DESTINATION_PUBLICATION_ENABLE_ENV]:'true'}).map(source=>source.key),[`${oldRepo}#2`,`${newRepo}#77`]);
});

test('dual-source read keeps same numeric comment IDs separate, exact source bodies and independent watermarks',async t=>{
  const h=createConversationFixture(t);t.after(()=>h.close());
  const old=publication(crypto.randomUUID(),'Original issue briefing','2026-10-17','Exact old-source body  ');
  const next=publication(crypto.randomUUID(),'Destination issue briefing','2026-10-18','Exact destination body\n');
  const oldComment=comment(oldRepo,2,901,old),newComment=comment(newRepo,77,901,next);
  const forgedAuthor=comment(newRepo,77,902,publication(crypto.randomUUID(),'Forged','2026-10-19','Must be rejected'),{user:{id:'183016859'}});
  const wrongIssue=comment(newRepo,78,903,publication(crypto.randomUUID(),'Wrong issue','2026-10-20','Must be rejected'));
  const seen=[];
  await syncPublications(h.ctx,async url=>{
    const parsed=new URL(url);seen.push(parsed.pathname);
    if(parsed.pathname===`/repos/${oldRepo}/issues/2/comments`)return Response.json([oldComment]);
    if(parsed.pathname===`/repos/${newRepo}/issues/77/comments`)return Response.json([newComment,forgedAuthor,wrongIssue]);
    assert.fail(`Unexpected publication source ${parsed.pathname}`);
  },Date.parse(stamp),{[DESTINATION_PUBLICATION_ISSUE_ENV]:'77',[DESTINATION_PUBLICATION_ENABLE_ENV]:'true'});
  assert.deepEqual(seen,[`/repos/${oldRepo}/issues/2/comments`,`/repos/${newRepo}/issues/77/comments`]);
  const legacy=h.rows('SELECT comment_id,publication FROM imported_comments WHERE comment_id=901')[0];
  const destination=h.rows('SELECT source_key,comment_id,publication,raw_body,imported FROM publication_source_comments WHERE source_key=? AND comment_id=901',`${newRepo}#77`)[0];
  assert.ok(legacy);assert.equal(destination.comment_id,901);assert.equal(destination.source_key,`${newRepo}#77`);
  assert.equal(destination.raw_body,newComment.body,'Store the GitHub comment body byte-for-byte for provenance and rollback');
  assert.equal(JSON.parse(destination.publication).id,next.id);assert.equal(destination.imported,1);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM publication_source_comments WHERE source_key=? AND comment_id IN(902,903)',`${newRepo}#77`)[0].n,0,
    'Source imports require the numeric owner ID and exact issue URL');
  assert.equal(JSON.parse(legacy.publication).id,old.id);
  assert.equal(h.rows('SELECT value FROM shared_meta WHERE key=?','publisher-source-scan:'+`${newRepo}#77`).length,1);
  assert.equal(h.rows('SELECT value FROM shared_meta WHERE key=?','publisher-v2-coverage').length,1,'The established old-source watermark remains in its original namespace');
  const status=JSON.parse(h.rows('SELECT value FROM shared_meta WHERE key=?','publisher-status')[0].value);
  assert.deepEqual(status.additionalSources,[{source:`${newRepo}#77`,pending:0,conflicts:0,morePending:false,moreConflicts:false,
    catchingUp:false,watermarkEstablished:true}]);
  const posts=(await sharedStore(h.ctx,'/internal/shared/state',{},new URLSearchParams({after:'0'})).json()).posts;
  assert.deepEqual(posts.map(post=>post.id),[old.id,next.id]);
  assert.deepEqual(posts.map(post=>post.body),['Exact old-source body','Exact destination body']);
});

test('same-date briefing reservation remains global across old and future sources',async t=>{
  const h=createConversationFixture(t);t.after(()=>h.close());
  const old=comment(oldRepo,2,902,publication(crypto.randomUUID(),'First','2026-10-17','First body'));
  const next=comment(newRepo,88,902,publication(crypto.randomUUID(),'Second','2026-10-17','Second body'));
  const target={ [DESTINATION_PUBLICATION_ISSUE_ENV]:'88',[DESTINATION_PUBLICATION_ENABLE_ENV]:'true' };
  await syncPublications(h.ctx,async url=>new URL(url).pathname===`/repos/${oldRepo}/issues/2/comments`?Response.json([old]):Response.json([next]),Date.parse(stamp),target);
  const state=await sharedStore(h.ctx,'/internal/shared/state',{},new URLSearchParams({after:'0'})).json();
  assert.equal(state.posts.length,1);assert.equal(state.posts[0].id,JSON.parse(old.body).id);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM shared_briefing_dates WHERE date=?','2026-10-17')[0].n,1);
  assert.equal(h.rows('SELECT imported FROM publication_source_comments WHERE source_key=? AND comment_id=902',`${newRepo}#88`)[0].imported,2);
});

test('the same publication ID and exact body replayed from both sources creates one public post',async t=>{
  const h=createConversationFixture(t);t.after(()=>h.close());
  const shared=publication(crypto.randomUUID(),'Same briefing','2026-10-17','Identical body');
  const old=comment(oldRepo,2,904,shared),next=comment(newRepo,89,904,shared);
  await syncPublications(h.ctx,async url=>new URL(url).pathname===`/repos/${oldRepo}/issues/2/comments`?Response.json([old]):Response.json([next]),Date.parse(stamp),
    {[DESTINATION_PUBLICATION_ISSUE_ENV]:'89',[DESTINATION_PUBLICATION_ENABLE_ENV]:'true'});
  const state=await sharedStore(h.ctx,'/internal/shared/state',{},new URLSearchParams({after:'0'})).json();
  assert.equal(state.posts.filter(post=>post.id===shared.id).length,1);
  assert.equal(h.rows('SELECT imported FROM publication_source_comments WHERE source_key=? AND comment_id=904',`${newRepo}#89`)[0].imported,1);
});

test('source pending work retries after its missing original arrives without changing the legacy source cursor',async t=>{
  const h=createConversationFixture(t);t.after(()=>h.close());
  const requestId=crypto.randomUUID(),reply={schema:'jarvis-publication-v1',id:crypto.randomUUID(),type:'reply',replyTo:requestId,body:'Delayed exact reply'};
  const destination=comment(newRepo,91,905,reply),env={[DESTINATION_PUBLICATION_ISSUE_ENV]:'91',[DESTINATION_PUBLICATION_ENABLE_ENV]:'true'};
  const fetcher=async url=>new URL(url).pathname===`/repos/${newRepo}/issues/91/comments`?Response.json([destination]):Response.json([]);
  await syncPublications(h.ctx,fetcher,Date.parse(stamp),env);
  assert.equal(h.rows('SELECT imported FROM publication_source_comments WHERE source_key=? AND comment_id=905',`${newRepo}#91`)[0].imported,0);
  const legacyCoverage=h.rows('SELECT value FROM shared_meta WHERE key=?','publisher-v2-coverage')[0].value;
  sharedStore(h.ctx,'/internal/shared/message',{id:requestId,body:'Fictional original request'});
  await syncPublications(h.ctx,()=>assert.fail('A new original must release journaled source work without upstream success'),Date.parse(stamp)+1000,env);
  assert.equal(h.rows('SELECT imported FROM publication_source_comments WHERE source_key=? AND comment_id=905',`${newRepo}#91`)[0].imported,1);
  assert.equal(h.rows('SELECT value FROM shared_meta WHERE key=?','publisher-v2-coverage')[0].value,legacyCoverage,
    'Destination retries leave the historical issue checkpoint untouched');
  const status=JSON.parse(h.rows('SELECT value FROM shared_meta WHERE key=?','publisher-status')[0].value);
  assert.deepEqual(status.additionalSources[0],{source:`${newRepo}#91`,pending:0,conflicts:0,morePending:false,moreConflicts:false,
    catchingUp:false,watermarkEstablished:true});
});

test('empty destination feeds use the same adaptive idle backoff instead of polling every five minutes',async t=>{
  const h=createConversationFixture(t);t.after(()=>h.close());
  const env={[DESTINATION_PUBLICATION_ISSUE_ENV]:'92',[DESTINATION_PUBLICATION_ENABLE_ENV]:'true'},start=Date.parse(stamp);
  const calls=[];
  const fetcher=async url=>{calls.push(new URL(url).pathname);return Response.json([]);};
  for(const offset of [0,300000,600000])await syncPublications(h.ctx,fetcher,start+offset,env);
  const destinationPath=`/repos/${newRepo}/issues/92/comments`;
  assert.equal(calls.filter(path=>path===destinationPath).length,2,'The third five-minute tick is suppressed after two empty reads');
  await syncPublications(h.ctx,fetcher,start+900000,env);
  assert.equal(calls.filter(path=>path===destinationPath).length,3);
  await syncPublications(h.ctx,fetcher,start+2100000,env);
  assert.equal(calls.filter(path=>path===destinationPath).length,4,'The next empty-source check follows the capped twenty-minute backoff');
  assert.equal(h.rows('SELECT value FROM shared_meta WHERE key=?','publisher-source-idle:'+`${newRepo}#92`)[0].value,'4');
});

test('full-day source polling preserves the old reader share and existing hourly/daily ceilings',t=>{
  const h=createConversationFixture(t);t.after(()=>h.close());publicationSchema(h.ctx);
  const start=Date.UTC(2026,9,17),step=300000;let sourceReads=0,historicalReads=0;
  for(let offset=0;offset<86400000;offset+=step){
    const now=start+offset;
    if(offset%(30*60000)===0)assert.equal(takePublicationFetch(h.ctx,'reconcile',now).ok,true,'Historical source retains its existing scheduled share');
    const extra=takePublicationFetch(h.ctx,'source-reconcile',now);
    if(extra.ok)sourceReads++;else assert.equal(extra.reason,'daily_source_egress_budget');
    if(offset%(30*60000)===0)historicalReads++;
  }
  assert.equal(sourceReads,144,'The additional source uses at most half of the unchanged daily reconciliation budget');
  assert.equal(historicalReads,48);
  const daily=JSON.parse(h.rows('SELECT value FROM shared_meta WHERE key=?','publisher-reconcile-day')[0].value);
  assert.equal(daily.total,192);
  assert.equal(daily.additionalSource,144);
  const nextDay=start+86400000;
  assert.equal(takePublicationFetch(h.ctx,'source-reconcile',nextDay).ok,true,'The additive allowance resets at the UTC day boundary');
  assert.equal(takePublicationFetch(h.ctx,'reconcile',nextDay).ok,true,'The historical source allowance still remains available');
});

test('unresolved destination rows follow the persisted local cadence while a new public generation wakes immediately',async t=>{
  const h=createConversationFixture(t);t.after(()=>h.close());
  const start=Date.UTC(2026,9,17),requestId=crypto.randomUUID(),reply={schema:'jarvis-publication-v1',id:crypto.randomUUID(),type:'reply',replyTo:requestId,body:'Still waiting'};
  const env={[DESTINATION_PUBLICATION_ISSUE_ENV]:'93',[DESTINATION_PUBLICATION_ENABLE_ENV]:'true'};
  await syncPublications(h.ctx,async url=>new URL(url).pathname===`/repos/${newRepo}/issues/93/comments`?
    Response.json([comment(newRepo,93,906,reply)]):Response.json([]),start,env);
  const localAt=metadata(h,'publisher-local-next-attempt');
  assert.ok(localAt>start&&localAt<=start+1800000,'Unresolved local work follows the existing bounded idle cadence');
  const scheduled=nextPublicationReconciliationAt(h.ctx,start);
  assert.ok(scheduled>=start+300000&&localAt>start,'A still-missing original must not create an immediate alarm; normal source polling and local retry remain scheduled');
  assert.equal(publicationReadNeedsWake(h.ctx,start+1000,env),false,'The same unresolved journal row does not retrigger a warm read');
  sharedStore(h.ctx,'/internal/shared/message',{id:requestId,body:'New original request'});
  assert.equal(publicationReadNeedsWake(h.ctx,start+1000,env),true,'A new public generation remains an immediate wake');
  await syncPublications(h.ctx,()=>assert.fail('New-generation local recovery must not require an upstream read'),start+1000,env);
  assert.equal(h.rows('SELECT imported FROM publication_source_comments WHERE source_key=? AND comment_id=906',`${newRepo}#93`)[0].imported,1);
});

test('full-day scheduled reconciliation keeps unresolved destination work bounded and the historical source fair under repeated tail comments',async t=>{
  const h=createConversationFixture(t);t.after(()=>h.close());
  const start=Date.UTC(2026,9,17),end=start+86400000,requestId=crypto.randomUUID();
  const oldTail=comment(oldRepo,2,907,publication(crypto.randomUUID(),'Historical tail','2026-10-17','Already-covered historical tail'));
  const unresolved=comment(newRepo,94,907,{schema:'jarvis-publication-v1',id:crypto.randomUUID(),type:'reply',replyTo:requestId,body:'Waiting for original'});
  const env={[DESTINATION_PUBLICATION_ISSUE_ENV]:'94',[DESTINATION_PUBLICATION_ENABLE_ENV]:'true'};
  let oldReads=0,additionalReads=0,passes=0,now=start;
  const fetcher=async url=>{
    const path=new URL(url).pathname;
    if(path===`/repos/${oldRepo}/issues/2/comments`){oldReads++;return Response.json([oldTail]);}
    if(path===`/repos/${newRepo}/issues/94/comments`){additionalReads++;return Response.json([unresolved]);}
    assert.fail(`Unexpected source request ${path}`);
  };
  while(now<end&&passes<500){
    await syncPublications(h.ctx,fetcher,now,env);passes++;
    const next=nextPublicationReconciliationAt(h.ctx,now);
    assert.ok(next>now,`The next alarm must advance after pass ${passes}`);
    now=next;
  }
  assert.ok(passes<480,`Unresolved journal work consumed ${passes} of the 480 daily pass allowance`);
  assert.ok(passes<=288,`Normal five-minute local cadence permits at most 288 scheduled passes/day, got ${passes}`);
  assert.equal(h.rows('SELECT imported FROM publication_source_comments WHERE source_key=? AND comment_id=907',`${newRepo}#94`)[0].imported,0,
    'The missing original remains pending throughout the simulated day');
  assert.ok(additionalReads>0&&additionalReads<=144,`The secondary source remains within its half-budget: ${additionalReads}`);
  assert.ok(oldReads>=40&&oldReads<=60,`Duplicate tail comments must back off instead of forcing five-minute historical reads: ${oldReads}`);
  const passBudget=metadata(h,'publisher-pass-budget'),egressBudget=metadata(h,'publisher-reconcile-day');
  assert.equal(passBudget.total,passes);
  assert.ok(passBudget.total<480);
  assert.ok(egressBudget.total<=288,`Both sources stay within the existing reconciliation ceiling: ${egressBudget.total}`);
  assert.ok(egressBudget.additionalSource<=144);
});
