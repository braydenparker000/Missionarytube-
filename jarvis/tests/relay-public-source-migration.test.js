import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture} from './helpers/relay-conversation-browser-fixture.js';
import {syncPublications,publicationSources,DESTINATION_PUBLICATION_ISSUE_ENV,DESTINATION_PUBLICATION_ENABLE_ENV} from '../backend/publications.js';
import {sharedStore} from '../backend/shared.js';

const oldRepo='braydenparker999/jarvis',newRepo='braydenparker000/Missionarytube-';
const oldIssue=`https://api.github.com/repos/${oldRepo}/issues/2`;
const stamp='2026-10-17T10:00:00Z';
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
  await syncPublications(h.ctx,fetcher,Date.parse(stamp)+300001,env);
  assert.equal(h.rows('SELECT imported FROM publication_source_comments WHERE source_key=? AND comment_id=905',`${newRepo}#91`)[0].imported,1);
  assert.equal(h.rows('SELECT value FROM shared_meta WHERE key=?','publisher-v2-coverage')[0].value,legacyCoverage,
    'Destination retries leave the historical issue checkpoint untouched');
});
