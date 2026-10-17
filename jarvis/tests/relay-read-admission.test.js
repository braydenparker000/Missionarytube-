import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayFixture} from './relay-fixture.js';
import {sharedStore,SHARED_OBJECT} from '../backend/shared.js';
import {publicationSchema,importPublicationHint,syncPublications} from '../backend/publications.js';
const uuid=()=>crypto.randomUUID();

test('rejected and durable pending hints avoid general scans; deferred work recovers during cooldown with its original IDs',async()=>{
  const f=createRelayFixture(),{ctx,db}=f.object(SHARED_OBJECT),now=Date.now(),requestId=uuid(),eventId=uuid();
  try{
    publicationSchema(ctx);
    const pending={type:'coordination',payload:{schema:'jarvis-coordination-v2',eventId,requestId,attemptId:uuid(),stage:'final',resultVersion:1,body:'Fictional deferred artifact',artifacts:[]},
      provenance:{source:'github-issue',repository:'braydenparker999/jarvis',issue:2,commentId:1001,authorId:183016859,publishedAt:'2026-10-08T00:00:00Z'}};
    db.prepare('INSERT INTO imported_comments(comment_id,publication) VALUES(?,?)').run(1001,JSON.stringify(pending));
    for(const [key,value] of Object.entries({'publisher-next-attempt':now+300000,'publisher-status':{ok:true},
      'publisher-egress-budget':{hour:Math.floor(now/3600000),minute:Math.floor(now/60000),total:48,hints:12,burst:2}}))
      db.prepare('INSERT OR REPLACE INTO shared_meta VALUES(?,?)').run(key,JSON.stringify(value));
    const queries=[],original=ctx.storage.sql.exec.bind(ctx.storage.sql);
    ctx.storage.sql.exec=(query,...values)=>{queries.push(query);return original(query,...values);};
    const reject=await importPublicationHint(ctx,{commentId:2001},()=>assert.fail('No egress permit'),now);
    assert.equal(reject.status,429);
    const prior=await importPublicationHint(ctx,{commentId:1001},()=>assert.fail('Durable pending receipt needs no refetch'),now);
    assert.equal(prior.status,202);assert.equal((await prior.json()).publicationId,eventId);
    assert.equal(queries.some(q=>q.includes('WHERE imported=0')||q.includes('json_extract')||q.includes('SELECT * FROM shared_entries WHERE seq>')),false);
    assert.equal(db.prepare('SELECT imported FROM imported_comments WHERE comment_id=1001').get().imported,0);
    sharedStore(ctx,'/internal/shared/message',{id:requestId,body:'Fictional delayed original'});
    await syncPublications(ctx,()=>assert.fail('Original arrival resolves pending work inside existing cooldown'),now+1);
    const accepted=await importPublicationHint(ctx,{commentId:1001},()=>assert.fail('No refetch after recovery'),now+2);
    assert.equal(accepted.status,200);assert.equal((await accepted.json()).publicationId,eventId);
    assert.equal(db.prepare('SELECT id FROM shared_entries WHERE reply_to=?').get(requestId).id,eventId);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM public_coordination_events').get().n,1);
  }finally{f.close();}
});
test('an exact legacy conflict hint recovers its hidden final without a historical scan or rewriting the accepted reply',async()=>{
  const f=createRelayFixture(),{ctx,db}=f.object(SHARED_OBJECT),requestId=uuid(),replyId=uuid(),lateId=uuid();
  try{
    publicationSchema(ctx);
    sharedStore(ctx,'/internal/shared/message',{id:requestId,body:'Fictional artifact request'});
    sharedStore(ctx,'/internal/shared/reply',{id:replyId,replyTo:requestId,body:'Fictional immutable hold'});
    const p={id:lateId,type:'reply',replyTo:requestId,body:'Fictional final: https://example.test/artifact',createdAt:'2026-10-08T00:00:00Z'};
    db.prepare('INSERT INTO imported_comments VALUES(?,?,2,?)').run(1002,JSON.stringify(p),'Conflicting publication; original kept');
    const queries=[],original=ctx.storage.sql.exec.bind(ctx.storage.sql);
    ctx.storage.sql.exec=(query,...values)=>{queries.push(query);return original(query,...values);};
    const accepted=await importPublicationHint(ctx,{commentId:1002},()=>assert.fail('Trusted durable target needs no refetch'));
    assert.equal(accepted.status,200);assert.equal((await accepted.json()).status,'update-imported');
    assert.equal(queries.some(q=>q.includes('WHERE imported=0')||q.includes('json_extract')),false);
    const retry=await importPublicationHint(ctx,{commentId:1002},()=>assert.fail('Lost receipt retry needs no egress'));
    assert.equal(retry.status,200);
    assert.equal(db.prepare('SELECT body FROM shared_entries WHERE reply_to=?').get(requestId).body,'Fictional immutable hold');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM public_coordination_events').get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM relay_events WHERE message_id LIKE 'public-result:%'").get().n,1);
  }finally{f.close();}
});
