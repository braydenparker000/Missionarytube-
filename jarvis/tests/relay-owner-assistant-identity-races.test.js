import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assistantFixture,id} from './helpers/relay-assistant-attachment-fixture.js';
const conflict=e=>e.data?.status===409;
async function accepted(s,kind='deliverable'){
 const message=id(),delivery=id();await s.send(message);
 if(kind==='deliverable')await s.rpc('relay_owner_reply',{inbox_id:s.inbox,message_id:message,body:'Synthetic accepted text remains immutable.'});
 const file=(await s.assistantUpload(message,delivery)).attachment;
 const receipt=await s.commit(message,delivery,[file],'Synthetic accepted file',kind);
 return {message,delivery,file,receipt,kind};
}
test('assistant identity review: inbound uploads cannot reuse an accepted delivery UUID or break identical reconciliation',async t=>{
 for(const kind of ['reply','deliverable']){
  const s=await assistantFixture(t),a=await accepted(s,kind),bytes=s.sql('SELECT bytes FROM relay_owner_attachments WHERE id=?',a.file.id)[0].bytes,entries=s.sql('SELECT * FROM relay_owner_entries');
  const incoming=await s.upload(id(),{id:a.delivery});assert.equal(incoming.status,409);
  const retry=await s.commit(a.message,a.delivery,[a.file],'Synthetic accepted file',kind);assert.equal(retry.newWrite,false);assert.deepEqual(retry.delivery,a.receipt.delivery);
  assert.deepEqual(s.sql('SELECT bytes FROM relay_owner_attachments WHERE id=?',a.file.id)[0].bytes,bytes);assert.deepEqual(s.sql('SELECT * FROM relay_owner_entries'),entries);
  assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_attachments WHERE id=?',a.delivery)[0].n,0);
 }
});
test('assistant identity review: already accepted deliveries reconcile even with a preexisting legacy inbound identity alias',async t=>{
 for(const kind of ['reply','deliverable']){
  const s=await assistantFixture(t),a=await accepted(s,kind),bytes=Buffer.from('Synthetic legacy inbound bytes'),message=id(),sha=createHash('sha256').update(bytes).digest('hex');
  // Represent a row admitted by an older Worker. New writers must reject it,
  // while reconciliation must preserve both already accepted byte identities.
  s.sql('INSERT INTO relay_owner_attachments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',a.delivery,message,s.principal.principal,s.first.device_id,'synthetic-legacy.txt','text/plain',bytes.length,sha,bytes,Date.now(),Date.now()+86400000,'staged',null);
  const retry=await s.commit(a.message,a.delivery,[a.file],'Synthetic accepted file',kind);
  assert.equal(retry.newWrite,false);assert.deepEqual(retry.delivery,a.receipt.delivery);
  const inbound=await s.upload(message,{id:a.delivery,name:'synthetic-legacy.txt',data_base64:bytes.toString('base64')});assert.equal(inbound.status,200);
  assert.deepEqual(Buffer.from(s.sql('SELECT bytes FROM relay_owner_attachments WHERE id=?',a.delivery)[0].bytes),bytes);
  await assert.rejects(s.commit(a.message,a.delivery,[a.file],'Different text',kind),conflict);
 }
});
test('assistant identity review: pending/accepted delivery and assistant-file identities cannot become new inbound messages or stages',async t=>{
 for(const commitFirst of [false,true]){
  const s=await assistantFixture(t),message=id(),delivery=id();await s.send(message);const file=(await s.assistantUpload(message,delivery)).attachment;
  if(commitFirst)await s.commit(message,delivery,[file]);
  const entries=s.sql('SELECT * FROM relay_owner_entries'),queued=s.queued.length;
  for(const reserved of [delivery,file.id]){
   assert.equal((await s.send(reserved,[],'Synthetic conflicting inbound message')).status,409);
   assert.equal((await s.upload(reserved)).status,409);
  }
  assert.deepEqual(s.sql('SELECT * FROM relay_owner_entries'),entries);assert.equal(s.queued.length,queued);
  assert.equal((await s.commit(message,delivery,[file])).newWrite,!commitFirst);
 }
});
test('assistant identity review: inbound discard cannot reserve a staged or accepted outbound delivery identity',async t=>{
 const s=await assistantFixture(t),message=id(),delivery=id();await s.send(message);const file=(await s.assistantUpload(message,delivery)).attachment;
 for(const acceptedFirst of [false,true]){
  if(acceptedFirst)await s.commit(message,delivery,[file]);
  const missing=id(),discard=await s.store({op:'attachment_discard',token_hash:s.first.token_hash,message_id:missing,attachment_id:delivery});assert.equal(discard.status,200);assert.equal((await discard.json()).newWrite,false);
  const wrongRoot=await s.store({op:'attachment_discard',token_hash:s.first.token_hash,message_id:delivery,attachment_id:missing});assert.equal(wrongRoot.status,200);assert.equal((await wrongRoot.json()).newWrite,false);
  assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_attachments WHERE id IN (?,?)',delivery,missing)[0].n,0);
 }
 assert.equal((await s.commit(message,delivery,[file])).newWrite,false);
});
test('assistant identity review: existing inbound stages, messages and cancellation tombstones symmetrically reserve their identities',async t=>{
 const s=await assistantFixture(t),original=id();await s.send(original);
 const staged=id(),incomingMessage=id();assert.equal((await s.upload(incomingMessage,{id:staged})).status,201);
 const existingMessage=id();await s.send(existingMessage);
 const cancelled=id();await s.store({op:'attachment_discard',token_hash:s.first.token_hash,message_id:id(),attachment_id:cancelled});
 for(const reserved of [staged,existingMessage,cancelled])await assert.rejects(s.assistantUpload(original,reserved),conflict);
 assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_assistant_attachment_targets')[0].n,0);
 assert.equal(s.sql('SELECT state FROM relay_owner_attachments WHERE id=?',staged)[0].state,'staged');assert.equal(s.sql('SELECT state FROM relay_owner_attachments WHERE id=?',cancelled)[0].state,'discarded');
});
test('assistant identity review: upload races admit only one reservation and never partially write the loser',async t=>{
 for(const winner of ['assistant','inbound']){
  const s=await assistantFixture(t),original=id(),delivery=id(),outFile=id(),inMessage=id();await s.send(original);
  let outRelease,inRelease,outStarted,inStarted;
  const outWait=new Promise(r=>{outRelease=r;}),inWait=new Promise(r=>{inRelease=r;}),outAtHash=new Promise(r=>{outStarted=r;}),inAtHash=new Promise(r=>{inStarted=r;}),digest=crypto.subtle.digest.bind(crypto.subtle);
  const mock=t.mock.method(crypto.subtle,'digest',async(...args)=>{
   const text=new TextDecoder().decode(args[1]);
   if(text==='Synthetic assistant race'){outStarted();await outWait;}
   if(text==='Synthetic inbound race'){inStarted();await inWait;}
   return digest(...args);
  });
  const out=s.assistantUpload(original,delivery,{attachment_id:outFile,data_base64:Buffer.from('Synthetic assistant race').toString('base64')});
  const incoming=s.upload(inMessage,{id:delivery,data_base64:Buffer.from('Synthetic inbound race').toString('base64')});
  await Promise.all([outAtHash,inAtHash]);
  if(winner==='assistant'){
   outRelease();const file=(await out).attachment;inRelease();assert.equal((await incoming).status,409);
   assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_attachments WHERE id=?',delivery)[0].n,0);
   await s.commit(original,delivery,[file]);
  }else{
   inRelease();assert.equal((await incoming).status,201);outRelease();await assert.rejects(out,conflict);
   assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_attachments WHERE id=?',outFile)[0].n,0);assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_assistant_attachment_targets')[0].n,0);
  }
  assert.equal(s.sql('SELECT uploads FROM relay_owner_attachment_rates')[0].uploads,1);
  mock.mock.restore();
 }
});
test('assistant identity review: message admission during file hashing wins atomically and cannot poison an established assistant stage',async t=>{
 const s=await assistantFixture(t),original=id(),delivery=id(),outFile=id();await s.send(original);
 let release,started;const wait=new Promise(r=>{release=r;}),atHash=new Promise(r=>{started=r;}),digest=crypto.subtle.digest.bind(crypto.subtle);
 const mock=t.mock.method(crypto.subtle,'digest',async(...args)=>{started();await wait;return digest(...args);});
 const out=s.assistantUpload(original,delivery,{attachment_id:outFile});await atHash;
 assert.equal((await s.send(outFile,[],'Synthetic message wins the UUID reservation')).status,201);
 release();await assert.rejects(out,conflict);mock.mock.restore();
 assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_assistant_attachment_targets')[0].n,0);
 const secondDelivery=id(),file=(await s.assistantUpload(original,secondDelivery)).attachment;
 const before=s.sql('SELECT * FROM relay_owner_entries');assert.equal((await s.send(file.id,[],'Synthetic conflicting message')).status,409);
 assert.deepEqual(s.sql('SELECT * FROM relay_owner_entries'),before);assert.equal((await s.commit(original,secondDelivery,[file])).newWrite,true);
});
