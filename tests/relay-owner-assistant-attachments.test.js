import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assistantFixture,id,raster} from './helpers/relay-assistant-attachment-fixture.js';
import {sharedStore} from '../backend/shared.js';
import {relayRpc} from '../backend/relay-connector.js';
import {ATTACHMENT_LIMITS} from '../backend/relay-owner-attachments.js';
const pdf=JSON.parse(readFileSync(new URL('./fixtures/relay-attachment-document.json',import.meta.url))).pdf;
const status=n=>e=>e.data?.status===n;
const stage=async(s,message,delivery,options)=>(await s.assistantUpload(message,delivery,options)).attachment;
test('private chat update feed pages immutable deliveries across originals and rejects unauthenticated readers',async t=>{
 const s=await assistantFixture(t),originals=[id(),id()];for(const message of originals)await s.send(message);
 const expected=[];for(const message of originals)for(let n=0;n<26;n++)expected.push((await s.commit(message,id(),[],'Synthetic update '+n)).delivery.id);
 assert.equal((await s.http('/updates?after=0',{token:null})).status,401);
 const first=await(await s.http('/updates?after=0')).json();assert.equal(first.updates.length,50);assert.equal(first.visibility,'private');
 const second=await(await s.http('/updates?after='+first.nextCursor)).json();assert.equal(second.updates.length,2);assert.equal(second.nextCursor,null);assert.deepEqual([...first.updates,...second.updates].map(x=>x.id),expected);
 assert.deepEqual((await(await s.http('/updates?after='+second.updates.at(-1).sequence)).json()).updates,[]);
 const foreign=id();s.sql("INSERT INTO relay_owner_entries(id,kind,body,created_at,principal,device_id,authentication_source) VALUES(?,'user',?,?,?,?,?)",foreign,'Foreign private data',new Date().toISOString(),'github:987654321',id(),'owner-device-session');
 s.sql("INSERT INTO relay_owner_assistant_deliveries(id,message_id,kind,body,created_at,principal,grant_id) VALUES(?,?,'deliverable',?,?,?,?)",id(),foreign,'Foreign update',new Date().toISOString(),'github:987654321',s.principal.grantId);
 assert.deepEqual((await(await s.http('/updates?after='+second.updates.at(-1).sequence)).json()).updates,[]);
});
test('private text updates: exact retries, owner isolation and immutable accepted result',async t=>{
 const s=await assistantFixture(t),message=id(),run=id();await s.send(message);
 await s.rpc('relay_owner_job_claim',{inbox_id:s.inbox,job_id:message,run_id:run,event_id:id()});
 const reply=await s.rpc('relay_owner_reply',{inbox_id:s.inbox,message_id:message,body:'Synthetic immutable result.'});
 await s.rpc('relay_owner_job_update',{inbox_id:s.inbox,job_id:message,run_id:run,event_id:id(),stage:'completed',expected_reply_id:reply.entry.id,expected_version:1,summary:'Synthetic checked result.',outcome:'known'});
 const before=await s.rpc('relay_owner_job_read',{inbox_id:s.inbox,job_id:message}),entries=s.sql('SELECT * FROM relay_owner_entries'),events=s.sql('SELECT * FROM relay_owner_job_events');
 const update=s.commitArgs(message,id(),[],'Synthetic progress update.');
 await assert.rejects((async()=>{await s.connector('relay_owner_deliverable_send',update);throw Error('Synthetic lost response');})(),/lost response/);
 const retry=(await s.connector('relay_owner_deliverable_send',update)).structuredContent;assert.equal(retry.newWrite,false);assert.deepEqual(retry.delivery.attachments,[]);
 await assert.rejects(s.connector('relay_owner_deliverable_send',{...update,body:'Changed update'}),status(409));
 const second=await s.commit(message,id(),[],'Synthetic second update.');
 const history=(await s.connector('relay_owner_deliverables_list',{inbox_id:s.inbox,message_id:message})).structuredContent;
 assert.deepEqual(history.deliverables.map(x=>x.id),[update.delivery_id,second.delivery.id]);
 assert.deepEqual((await s.rpc('relay_owner_job_read',{inbox_id:s.inbox,job_id:message})).job,before.job);
 assert.deepEqual(s.sql('SELECT * FROM relay_owner_entries'),entries);assert.deepEqual(s.sql('SELECT * FROM relay_owner_job_events'),events);
 await assert.rejects(s.commit(message,id(),[],'   '),status(400));await assert.rejects(s.commit(message,id(),[],'x'.repeat(6001)),status(400));
 await assert.rejects(s.commit(message,id(),[],'Text-only first reply','reply'),status(400));
 const publicId=id();sharedStore(s.ctx,'/internal/shared/message',{id:publicId,body:'Synthetic public request'});
 for(const target of [publicId,reply.entry.id,id()])await assert.rejects(s.commit(target,id(),[],'Private update'),status(404));
 const catalog=await relayRpc(s.ctx,s.env,s.principal,{method:'tools/list',params:{_meta:{}}});
 const tool=catalog.tools.find(x=>x.name==='relay_owner_deliverable_send');assert.equal(tool.inputSchema.properties.attachment_ids.minItems,0);assert.deepEqual(tool.securitySchemes,[{type:'oauth2',scopes:['relay:owner']}]);
 assert.equal((await s.connector('relay_owner_deliverable_send',s.commitArgs(message,id(),[],'Unauthorized update'),{...s.principal,scopes:['relay:read']})).isError,true);
 const row=s.sql('SELECT value FROM relay_oauth WHERE key=?','grant:'+s.principal.grantId)[0],grant=JSON.parse(row.value);grant.revoked=true;s.sql('UPDATE relay_oauth SET value=? WHERE key=?',JSON.stringify(grant),'grant:'+s.principal.grantId);
 await assert.rejects(s.connector('relay_owner_deliverable_send',update),e=>e.code===-32012);assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_assistant_deliveries')[0].n,2);
});
test('assistant files: first file-only reply is immutable, privately linked and completion-unverified',async t=>{
 const s=await assistantFixture(t),message=id(),delivery=id();await s.send(message);
 const file=await stage(s,message,delivery,{name:'synthetic.png',mime_type:'image/png',data_base64:raster.png});
 const accepted=await s.commit(message,delivery,[file],'','reply');assert.equal(accepted.newWrite,true);assert.equal(accepted.delivery.id,delivery);
 const conversation=await(await s.http('/conversation?message_id='+message)).json();
 assert.equal(conversation.reply.id,delivery);assert.equal(conversation.reply.body,'');assert.equal(conversation.reply.attachments[0].messageId,message);
 assert.equal(conversation.message.attachments,undefined);assert.deepEqual(conversation.deliverables,[]);
 const repeat=await s.commit(message,delivery,[file],'','reply');assert.equal(repeat.newWrite,false);assert.deepEqual(repeat.delivery,accepted.delivery);
 const job=await s.rpc('relay_owner_job_read',{inbox_id:s.inbox,job_id:message});assert.equal(job.job.result.replyId,delivery);assert.equal(job.job.completion,null);
 await assert.rejects(s.commit(message,delivery,[file],'replacement','reply'),status(409));
 const read=await s.connector('relay_owner_attachment_read',{inbox_id:s.inbox,message_id:message,attachment_id:file.id});assert.equal(read.content.find(x=>x.type==='image').data,raster.png);
});
test('assistant files: later requested files preserve an already accepted text reply and its result version',async t=>{
 const s=await assistantFixture(t),message=id();await s.send(message);
 const reply=await s.rpc('relay_owner_reply',{inbox_id:s.inbox,message_id:message,body:'Synthetic accepted text remains unchanged.'});
 const delivery=id(),file=await stage(s,message,delivery,{name:'synthetic.pdf',mime_type:'application/pdf',data_base64:pdf});
 await assert.rejects(s.commit(message,delivery,[file],'Synthetic file receipt','reply'),status(409));
 assert.equal((await s.commit(message,delivery,[file])).newWrite,true);
 const conversation=await(await s.http('/conversation?message_id='+message)).json();
 assert.equal(conversation.reply.id,reply.entry.id);assert.equal(conversation.reply.body,reply.entry.body);assert.equal(conversation.reply.attachments,undefined);
 assert.equal(conversation.deliverables[0].id,delivery);assert.equal(conversation.deliverables[0].attachments[0].messageId,message);
 const job=await s.rpc('relay_owner_job_read',{inbox_id:s.inbox,job_id:message});assert.equal(job.job.result.replyId,reply.entry.id);assert.equal(job.job.resultVersion,1);assert.equal(job.job.completion,null);
 const binary=await s.http('/attachments/content?message_id='+message+'&attachment_id='+file.id);assert.deepEqual(Buffer.from(await binary.arrayBuffer()),Buffer.from(pdf,'base64'));assert.match(binary.headers.get('Content-Disposition'),/^attachment;/);
 assert.equal((await s.http('/attachments/content?message_id='+message+'&attachment_id='+file.id+'&preview=1')).status,415);
});
test('assistant files: later deliverables never consume the accepted reply slot',async t=>{
 const s=await assistantFixture(t),message=id(),delivery=id();await s.send(message);
 const file=await stage(s,message,delivery);await s.commit(message,delivery,[file]);
 const before=await s.rpc('relay_owner_list_pending',{inbox_id:s.inbox});assert.equal(before.messages.some(x=>x.id===message),true);
 const reply=await s.rpc('relay_owner_reply',{inbox_id:s.inbox,message_id:message,body:'Synthetic first text reply after a file.'});assert.equal(reply.newWrite,true);
 assert.equal((await s.rpc('relay_owner_read_conversation',{inbox_id:s.inbox,message_id:message})).deliverables[0].id,delivery);
});
test('assistant files: later delivery leaves a completed job, accepted result and execution attestation unchanged',async t=>{
 const s=await assistantFixture(t),message=id(),run=id();
 assert.equal((await s.store({op:'job_create',token_hash:s.first.token_hash,id:message,title:'Synthetic file generation',body:'Synthetic requested file',action_kind:'read_only'})).status,201);
 await s.rpc('relay_owner_job_claim',{inbox_id:s.inbox,job_id:message,run_id:run,event_id:id()});
 const reply=await s.rpc('relay_owner_reply',{inbox_id:s.inbox,message_id:message,body:'Synthetic accepted result.'});
 await s.rpc('relay_owner_job_update',{inbox_id:s.inbox,job_id:message,run_id:run,event_id:id(),stage:'completed',expected_reply_id:reply.entry.id,expected_version:1,summary:'Synthetic requested work completed in this fixture.',outcome:'known'});
 const before=await s.rpc('relay_owner_job_read',{inbox_id:s.inbox,job_id:message}),jobs=s.sql('SELECT * FROM relay_owner_jobs'),events=s.sql('SELECT * FROM relay_owner_job_events'),entries=s.sql('SELECT * FROM relay_owner_entries');
 const delivery=id(),file=await stage(s,message,delivery);await s.commit(message,delivery,[file]);
 const after=await s.rpc('relay_owner_job_read',{inbox_id:s.inbox,job_id:message});
 assert.deepEqual(after.job,before.job);assert.deepEqual(s.sql('SELECT * FROM relay_owner_jobs'),jobs);assert.deepEqual(s.sql('SELECT * FROM relay_owner_job_events'),events);assert.deepEqual(s.sql('SELECT * FROM relay_owner_entries'),entries);
 assert.equal(after.job.completion.replyId,reply.entry.id);assert.equal(after.job.resultVersion,1);
});
test('assistant files: uncertain stage and commit responses retry exact IDs without duplicate records',async t=>{
 const s=await assistantFixture(t),message=id(),delivery=id();await s.send(message);
 const args=s.uploadArgs(message,delivery);
 const lose=async promise=>{await promise;throw Error('Synthetic response connection lost after persistence');};
 await assert.rejects(lose(s.connector('relay_owner_attachment_upload',args)),/connection lost/);
 const repeated=(await s.connector('relay_owner_attachment_upload',args)).structuredContent;assert.equal(repeated.newWrite,false);
 const commit=s.commitArgs(message,delivery,[repeated.attachment]);
 await assert.rejects(lose(s.connector('relay_owner_deliverable_send',commit)),/connection lost/);
 assert.equal((await s.connector('relay_owner_deliverable_send',commit)).structuredContent.newWrite,false);
 assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_assistant_deliveries')[0].n,1);
 assert.equal(s.sql('SELECT uploads FROM relay_owner_attachment_rates')[0].uploads,1);
 await assert.rejects(s.connector('relay_owner_attachment_upload',{...args,data_base64:Buffer.from('Different valid UTF-8 bytes').toString('base64')}),status(409));
 await assert.rejects(s.connector('relay_owner_deliverable_send',{...commit,body:'Different body'}),status(409));
 await assert.rejects(s.connector('relay_owner_deliverable_send',{...commit,attachment_ids:[]}),status(409));
});
test('assistant files: order and linkage cannot change on an accepted delivery retry',async t=>{
 const s=await assistantFixture(t),message=id(),delivery=id();await s.send(message);
 const first=await stage(s,message,delivery),second=await stage(s,message,delivery,{name:'second.txt'});
 await s.commit(message,delivery,[first,second]);
 await assert.rejects(s.commit(message,delivery,[second,first]),status(409));
 await assert.rejects(s.commit(message,delivery,[first]),status(409));
 await assert.rejects(stage(s,message,delivery),status(409));
 await assert.rejects(s.commit(message,delivery,[first,second],'Synthetic private delivery','reply'),status(409));
});
test('assistant files: file UUIDs cannot collide with existing entries or reserved/accepted delivery identities',async t=>{
 const s=await assistantFixture(t),message=id(),delivery=id();await s.send(message);const file=await stage(s,message,delivery);
 await assert.rejects(s.assistantUpload(message,id(),{attachment_id:delivery}),status(409));
 const discarded=await s.connector('relay_owner_attachment_discard',{inbox_id:s.inbox,message_id:message,delivery_id:id(),attachment_id:delivery});assert.equal(discarded.structuredContent.newWrite,false);
 assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_attachments WHERE id=?',delivery)[0].n,0);
 await s.commit(message,delivery,[file]);
 await assert.rejects(s.assistantUpload(message,id(),{attachment_id:delivery}),status(409));
 await assert.rejects(s.assistantUpload(message,id(),{attachment_id:message}),status(400));
 assert.equal((await s.commit(message,delivery,[file])).newWrite,false);
});
test('assistant files: cross-message, cross-delivery and inbound file linkage fail closed',async t=>{
 const s=await assistantFixture(t),a=id(),b=id(),delivery=id();await s.send(a);await s.send(b);
 const file=await stage(s,a,delivery);
 await assert.rejects(s.commit(b,delivery,[file]),status(404));
 await assert.rejects(s.commit(a,id(),[file]),status(404));
 await assert.rejects(s.assistantUpload(b,delivery,{attachment_id:file.id}),status(404));
 const incomingMessage=id(),incoming=await(await s.upload(incomingMessage)).json();await s.send(incomingMessage,[incoming.attachment.id]);
 await assert.rejects(s.commit(a,delivery,[incoming.attachment]),status(404));
 assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_assistant_deliveries')[0].n,0);
});
test('assistant files: actual public, reply and foreign-owner original rows cannot receive or expose files',async t=>{
 const s=await assistantFixture(t),message=id(),delivery=id();await s.send(message);
 const file=await stage(s,message,delivery);await s.commit(message,delivery,[file]);
 const publicId=id();sharedStore(s.ctx,'/internal/shared/message',{id:publicId,body:'Synthetic public request'});
 const reply=await s.rpc('relay_owner_reply',{inbox_id:s.inbox,message_id:message,body:'Synthetic accepted reply'});
 const foreign=id();s.sql("INSERT INTO relay_owner_entries(id,kind,body,created_at,principal,device_id,authentication_source) VALUES(?,'user',?,?,?,?,?)",foreign,'Synthetic other principal',new Date().toISOString(),'github:987654321',id(),'owner-device-session');
 const failure=async target=>{try{await s.connector('relay_owner_deliverables_list',{inbox_id:s.inbox,message_id:target});assert.fail('Unauthorized original returned');}catch(e){return {message:e.message,code:e.code,status:e.data?.status};}};
 const absent=await failure(id());
 for(const target of [publicId,reply.entry.id,foreign]){
  assert.deepEqual(await failure(target),absent);
  await assert.rejects(s.assistantUpload(target,id()),status(404));
  assert.equal((await s.http('/attachments/content?message_id='+target+'&attachment_id='+file.id)).status,404);
 }
});
test('assistant files: staging from another genuine owner grant is inaccessible but accepted private files remain owner-readable',async t=>{
 const s=await assistantFixture(t),other=await assistantFixture(t),message=id(),delivery=id();await s.send(message);
 for(const row of other.sql('SELECT * FROM relay_oauth'))s.sql('INSERT OR REPLACE INTO relay_oauth VALUES(?,?,?,?)',row.key,row.category,row.value,row.expires_at);
 const file=await stage(s,message,delivery),args=s.commitArgs(message,delivery,[file]);
 await assert.rejects(s.connector('relay_owner_deliverable_send',args,other.principal),status(404));
 const inaccessible=await s.connector('relay_owner_attachment_discard',{inbox_id:s.inbox,message_id:message,delivery_id:delivery,attachment_id:file.id},other.principal);
 const absent=await s.connector('relay_owner_attachment_discard',{inbox_id:s.inbox,message_id:message,delivery_id:id(),attachment_id:id()},other.principal);assert.deepEqual(inaccessible.structuredContent,absent.structuredContent);
 assert.equal(s.sql('SELECT state FROM relay_owner_attachments WHERE id=?',file.id)[0].state,'staged');
 await s.commit(message,delivery,[file]);
 const read=await s.connector('relay_owner_attachment_read',{inbox_id:s.inbox,message_id:message,attachment_id:file.id},other.principal);assert.equal(read.isError,false);
});
test('assistant files: cancellation during hashing keeps a UUID tombstone and prevents delayed bytes',async t=>{
 const s=await assistantFixture(t),message=id(),delivery=id(),attachment=id();await s.send(message);
 let release,started;const wait=new Promise(r=>{release=r;}),atHash=new Promise(r=>{started=r;}),digest=crypto.subtle.digest.bind(crypto.subtle);
 t.mock.method(crypto.subtle,'digest',async(...args)=>{started();await wait;return digest(...args);});
 const uploading=s.assistantUpload(message,delivery,{attachment_id:attachment});await atHash;
 const discard=await s.connector('relay_owner_attachment_discard',{inbox_id:s.inbox,message_id:message,delivery_id:delivery,attachment_id:attachment});assert.equal(discard.structuredContent.discarded,true);
 release();await assert.rejects(uploading,status(409));
 const row=s.sql('SELECT state,bytes FROM relay_owner_attachments WHERE id=?',attachment)[0];assert.equal(row.state,'discarded');assert.equal(row.bytes,null);
 assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_attachment_rates')[0].n,0);
});
test('assistant files: grant revocation while hashing prevents staging or delivery',async t=>{
 const s=await assistantFixture(t),message=id(),delivery=id();await s.send(message);
 const digest=crypto.subtle.digest.bind(crypto.subtle);
 t.mock.method(crypto.subtle,'digest',async(...args)=>{
  const row=s.sql('SELECT value FROM relay_oauth WHERE key=?','grant:'+s.principal.grantId)[0],value=JSON.parse(row.value);value.revoked=true;
  s.sql('UPDATE relay_oauth SET value=? WHERE key=?',JSON.stringify(value),'grant:'+s.principal.grantId);return digest(...args);
 });
 await assert.rejects(s.assistantUpload(message,delivery),status(403));
 assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_attachments')[0].n,0);assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_assistant_attachment_targets')[0].n,0);
});
test('assistant files: active execution ownership still protects both first replies and later deliveries',async t=>{
 const s=await assistantFixture(t),other=await assistantFixture(t),message=id(),delivery=id();await s.send(message);
 for(const row of other.sql('SELECT * FROM relay_oauth'))s.sql('INSERT OR REPLACE INTO relay_oauth VALUES(?,?,?,?)',row.key,row.category,row.value,row.expires_at);
 const file=await stage(s,message,delivery);
 await s.rpc('relay_owner_job_claim',{inbox_id:s.inbox,job_id:message,run_id:id(),event_id:id()},other.principal);
 await assert.rejects(s.commit(message,delivery,[file]),status(409));
 await assert.rejects(s.commit(message,delivery,[file],'Synthetic guarded result','reply'),status(409));
 assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_assistant_deliveries')[0].n,0);assert.equal(s.sql('SELECT state FROM relay_owner_attachments WHERE id=?',file.id)[0].state,'staged');
});
test('assistant files: a failed reply/event transaction rolls back delivery, linking and accepted reply together',async t=>{
 const s=await assistantFixture(t),message=id(),delivery=id();await s.send(message);
 const file=await stage(s,message,delivery),exec=s.ctx.storage.sql.exec;
 const mocked=t.mock.method(s.ctx.storage.sql,'exec',(query,...args)=>{if(query.startsWith('INSERT INTO relay_owner_job_events'))throw Error('Synthetic event persistence failure');return exec(query,...args);});
 await assert.rejects(s.commit(message,delivery,[file],'Synthetic result','reply'),/persistence failure/);
 assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_assistant_deliveries')[0].n,0);
 assert.equal(s.sql("SELECT COUNT(*) AS n FROM relay_owner_entries WHERE kind='reply'")[0].n,0);
 assert.equal(s.sql('SELECT state FROM relay_owner_attachments WHERE id=?',file.id)[0].state,'staged');
 mocked.mock.restore();assert.equal((await s.commit(message,delivery,[file],'Synthetic result','reply')).newWrite,true);
});
test('assistant files: racing independent first replies retain exactly one accepted reply',async t=>{
 const s=await assistantFixture(t),message=id(),delivery=id();await s.send(message);const file=await stage(s,message,delivery);
 const results=await Promise.allSettled([s.commit(message,delivery,[file],'Synthetic file reply','reply'),s.rpc('relay_owner_reply',{inbox_id:s.inbox,message_id:message,body:'Synthetic competing text reply'})]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.data?.status===409).length,1);
 assert.equal(s.sql("SELECT COUNT(*) AS n FROM relay_owner_entries WHERE reply_to=?",message)[0].n,1);
});
test('assistant files: shared inbound quotas and lifetime identities reject before raster decoding',async t=>{
 const original=globalThis.DecompressionStream;let codecs=0;t.mock.method(globalThis,'DecompressionStream',function(...args){codecs++;return new original(...args);});
 for(const category of ['retained','staged','lifetime','dailyBytes','dailyCount']){
  const s=await assistantFixture(t),message=id(),delivery=id();await s.send(message);
  const count=category==='lifetime'?1024:category==='staged'?128:category==='retained'?1:0;
  for(let i=0;i<count;i++)s.sql('INSERT INTO relay_owner_attachments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id(),id(),s.principal.principal,s.first.device_id,'synthetic.txt','text/plain',category==='retained'?ATTACHMENT_LIMITS.retainedBytes:1,'0'.repeat(64),category==='lifetime'?null:Buffer.from('x'),Date.now(),Date.now()+86400000,category==='lifetime'?'discarded':category==='retained'?'linked':'staged',null);
  if(category.startsWith('daily'))s.sql('INSERT INTO relay_owner_attachment_rates VALUES(?,?,?)',new Date().toISOString().slice(0,10),category==='dailyCount'?64:0,category==='dailyBytes'?ATTACHMENT_LIMITS.dailyBytes:0);
  await assert.rejects(s.assistantUpload(message,delivery,{mime_type:'image/png',name:'synthetic.png',data_base64:raster.png}),status(429));
 }
 assert.equal(codecs,0);
});
test('assistant files: async quota races recheck the shared ledger at commit',async t=>{
 const s=await assistantFixture(t),message=id();await s.send(message);
 s.sql('INSERT INTO relay_owner_attachment_rates VALUES(?,?,?)',new Date().toISOString().slice(0,10),63,0);
 const results=await Promise.allSettled([s.assistantUpload(message,id()),s.assistantUpload(message,id())]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.data?.status===429).length,1);
 assert.equal(s.sql('SELECT uploads FROM relay_owner_attachment_rates')[0].uploads,64);
});
test('assistant files: malformed files consume bounded codec attempts and expired stages cannot be reused',async t=>{
 const s=await assistantFixture(t),message=id(),delivery=id();await s.send(message);
 const file=await stage(s,message,delivery);s.sql('UPDATE relay_owner_attachments SET expires_ms=? WHERE id=?',Date.now()-1,file.id);
 await assert.rejects(s.commit(message,delivery,[file]),status(410));
 for(let i=0;i<11;i++)await assert.rejects(s.assistantUpload(message,id(),{data_base64:'a==='}),status(400));
 await assert.rejects(s.assistantUpload(message,id()),status(429));
 assert.equal(s.sql("SELECT attempts FROM relay_owner_attachment_attempts WHERE bucket LIKE 'codec:day:%'")[0].attempts,12);
 assert.equal(s.sql('SELECT state,bytes FROM relay_owner_attachments WHERE id=?',file.id)[0].state,'expired');
});
test('assistant files: bounded later-delivery pagination is complete and accepted retries work at the limit',async t=>{
 const s=await assistantFixture(t),message=id();await s.send(message);
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const expected=[];let last;
 for(let i=0;i<32;i++){
  now+=60000;const delivery=id(),file=await stage(s,message,delivery);last={delivery,file};
  expected.push((await s.commit(message,delivery,[file])).delivery.id);
 }
 const seen=[];let cursor;
 do{const result=(await s.connector('relay_owner_deliverables_list',{inbox_id:s.inbox,message_id:message,...(cursor?{cursor}:{})})).structuredContent;seen.push(...result.deliverables.map(x=>x.id));cursor=result.nextCursor;}while(cursor);
 assert.deepEqual(seen,expected);assert.equal((await s.commit(message,last.delivery,[last.file])).newWrite,false);
 now+=60000;const excess=id(),file=await stage(s,message,excess);await assert.rejects(s.commit(message,excess,[file]),status(429));
 const http=await(await s.http('/deliverables?message_id='+message+'&limit=25')).json();assert.equal(http.deliverables.length,25);assert.equal(typeof http.nextCursor,'string');
 assert.equal(s.sql("SELECT COUNT(*) AS n FROM relay_owner_entries WHERE kind='reply'")[0].n,0);
 assert.equal((await s.http('/deliverables?message_id='+message+'&limit=26')).status,400);
});
test('assistant files: cached conversation output remains exact and new native schemas are flat owner-only writes',async t=>{
 const s=await assistantFixture(t),message=id(),delivery=id();await s.send(message);const file=await stage(s,message,delivery);await s.commit(message,delivery,[file]);
 const result=await s.connector('relay_owner_read_conversation',{inbox_id:s.inbox,message_id:message});
 assert.equal(result.structuredContent.deliverables,undefined);assert.equal(result.structuredContent.deliverablesNextCursor,undefined);
 assert.equal(result.content.some(x=>x.text?.includes('Private later assistant deliverables')&&x.text.includes(delivery)),true);
 const catalog=await relayRpc(s.ctx,s.env,s.principal,{method:'tools/list',params:{_meta:{}}});
 for(const name of ['relay_owner_attachment_upload','relay_owner_attachment_discard','relay_owner_reply_with_attachments','relay_owner_deliverable_send','relay_owner_deliverables_list']){
  const tool=catalog.tools.find(x=>x.name===name);assert.ok(tool);assert.equal(tool.inputSchema.additionalProperties,false);assert.equal(tool.inputSchema.oneOf,undefined);assert.deepEqual(tool.securitySchemes,[{type:'oauth2',scopes:['relay:owner']}]);
 }
 const publicActor={...s.principal,scopes:['relay:read']};assert.equal((await s.connector('relay_owner_deliverable_send',s.commitArgs(message,id(),[file]),publicActor)).isError,true);
});
