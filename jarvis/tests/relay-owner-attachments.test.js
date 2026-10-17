import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {attachmentFixture,id,saved,raster,output} from './helpers/relay-attachment-fixture.js';
import {relayAttachmentPrepare,ATTACHMENT_LIMITS} from '../backend/relay-owner-attachments.js';
test('private attachments: cancellation before an upload settles reserves its UUID and blocks delayed bytes',async t=>{
 const s=await attachmentFixture(t),message=id(),attachment=id(),original=crypto.subtle.digest.bind(crypto.subtle);
 let release,started;const waiting=new Promise(resolve=>{release=resolve;});const atHash=new Promise(resolve=>{started=resolve;});
 t.mock.method(crypto.subtle,'digest',async(...args)=>{started();await waiting;return original(...args);});
 const upload=s.upload(message,{id:attachment});await atHash;
 const removed=await s.store({op:'attachment_discard',token_hash:s.first.token_hash,message_id:message,attachment_id:attachment});assert.equal(removed.status,200);
 release();assert.equal((await upload).status,409);
 const row=s.sql('SELECT state,bytes FROM relay_owner_attachments WHERE id=?',attachment)[0];assert.equal(row.state,'discarded');assert.equal(row.bytes,null);
 assert.equal((await s.send(message,[attachment])).status,410);
});
function crc(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;}
function pngChunk(type,data){const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4,4,'ascii');data.copy(out,8);out.writeUInt32BE(crc(out.subarray(4,-4)),out.length-4);return out;}
function pngHeader(w=3,h=2){const b=Buffer.alloc(13);b.writeUInt32BE(w);b.writeUInt32BE(h,4);b[8]=8;b[9]=6;return pngChunk('IHDR',b);}
function pngImage(header,extra=[],raw=Buffer.alloc(26)){return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),header,...extra,pngChunk('IDAT',deflateSync(raw)),pngChunk('IEND',Buffer.alloc(0))]);}
const prepareRaster=(mime,bytes)=>relayAttachmentPrepare({id:id(),message_id:id(),name:'fixture.bin',mime_type:mime,data_base64:bytes.toString('base64')});
test('private attachments: PNG full scanline bound rejects bombs, bad CRC, incomplete and conflicting headers',async()=>{
 await assert.rejects(prepareRaster('image/png',pngImage(pngHeader(),[],Buffer.alloc(1048576))),e=>e.data.status===400&&/decoded size/.test(e.message));
 await assert.rejects(prepareRaster('image/png',pngImage(pngHeader(8193,1))),e=>e.data.status===413);
 await assert.rejects(prepareRaster('image/png',pngImage(pngHeader(),[pngHeader()])),e=>e.data.status===400);
 const corrupted=Buffer.from(raster.png,'base64');corrupted[corrupted.length-1]^=1;
 await assert.rejects(prepareRaster('image/png',corrupted),e=>e.data.status===400);
 await assert.rejects(prepareRaster('image/png',Buffer.from(raster.png,'base64').subarray(0,-12)),e=>e.data.status===400);
 const filters=Buffer.alloc(26);filters[0]=5;await assert.rejects(prepareRaster('image/png',pngImage(pngHeader(),[],filters)),e=>e.data.status===400);
});
test('private attachments: animated PNG and compressed ancillary metadata are rejected before decoding',async()=>{
 for(const name of ['acTL','fcTL','fdAT','iCCP','zTXt','iTXt'])await assert.rejects(prepareRaster('image/png',pngImage(pngHeader(),[pngChunk(name,Buffer.alloc(8))])),e=>e.data.status===415);
});
function webpChunks(bytes){const list=[];for(let p=12;p<bytes.length;){const size=bytes.readUInt32LE(p+4);list.push({type:bytes.toString('ascii',p,p+4),start:p,data:bytes.subarray(p+8,p+8+size),chunk:bytes.subarray(p,p+8+size+(size&1))});p+=8+size+(size&1);}return list;}
function webpChunk(type,data){const out=Buffer.alloc(8+data.length+(data.length&1));out.write(type,0,4,'ascii');out.writeUInt32LE(data.length,4);data.copy(out,8);return out;}
function webpContainer(chunks){const data=Buffer.concat(chunks),header=Buffer.alloc(12);header.write('RIFF');header.writeUInt32LE(data.length+4,4);header.write('WEBP',8);return Buffer.concat([header,data]);}
test('private attachments: WebP extended canvas must agree with the actual unique frame',async()=>{
 const original=Buffer.from(raster.webp,'base64'),parts=webpChunks(original),canvas=parts.find(x=>x.type==='VP8X'),frame=parts.find(x=>['VP8 ','VP8L'].includes(x.type));assert.ok(canvas&&frame);
 const changed=Buffer.from(original);changed.writeUIntLE(3,canvas.start+12,3);
 await assert.rejects(prepareRaster('image/webp',changed),e=>e.data.status===400&&/disagree/.test(e.message));
 const huge=Buffer.from(original);huge.writeUIntLE(8192,canvas.start+12,3);
 await assert.rejects(prepareRaster('image/webp',huge),e=>e.data.status===413);
 await assert.rejects(prepareRaster('image/webp',webpContainer([...parts.map(x=>x.chunk),frame.chunk])),e=>e.data.status===400);
 await assert.rejects(prepareRaster('image/webp',webpContainer([canvas.chunk,...parts.map(x=>x.chunk)])),e=>e.data.status===415);
});
test('private attachments: WebP animation flags and chunks cannot bypass a static frame limit',async()=>{
 const original=Buffer.from(raster.webp,'base64'),parts=webpChunks(original),canvas=parts.find(x=>x.type==='VP8X');
 const flagged=Buffer.from(original);flagged[canvas.start+8]|=2;await assert.rejects(prepareRaster('image/webp',flagged),e=>e.data.status===415);
 for(const name of ['ANIM','ANMF'])await assert.rejects(prepareRaster('image/webp',webpContainer([...parts.map(x=>x.chunk),webpChunk(name,Buffer.alloc(8))])),e=>e.data.status===415);
 const corrupt=Buffer.from(original);corrupt.writeUInt32LE(original.length,4);await assert.rejects(prepareRaster('image/webp',corrupt),e=>e.data.status===400);
});
test('private attachments: JPEG repeated/conflicting dimensions and oversized sampling fail closed',async()=>{
 const original=Buffer.from(raster.jpeg,'base64');let p=2,sof;
 while(p<original.length){const marker=original[p+1],size=original.readUInt16BE(p+2);if([192,193,194].includes(marker)){sof={start:p,size};break;}p+=size+2;}
 assert.ok(sof);
 const large=Buffer.from(original);large.writeUInt16BE(8193,sof.start+7);await assert.rejects(prepareRaster('image/jpeg',large),e=>e.data.status===413);
 const sampling=Buffer.from(original);sampling[sof.start+11]=255;await assert.rejects(prepareRaster('image/jpeg',sampling),e=>e.data.status===400);
 const duplicate=Buffer.concat([original.subarray(0,sof.start),original.subarray(sof.start,sof.start+sof.size+2),original.subarray(sof.start)]);
 await assert.rejects(prepareRaster('image/jpeg',duplicate),e=>e.data.status===400);
 await assert.rejects(prepareRaster('image/jpeg',original.subarray(0,-2)),e=>e.data.status===400);
 for(const marker of [200,220,222,223]){
  const override=Buffer.from([255,marker,0,4,255,255]);
  await assert.rejects(prepareRaster('image/jpeg',Buffer.concat([original.subarray(0,2),override,original.subarray(2)])),e=>e.data.status===415);
 }
});
const pdf=Buffer.from(JSON.parse(readFileSync(new URL('./fixtures/relay-attachment-document.json',import.meta.url))).pdf,'base64');
const preparePdf=bytes=>relayAttachmentPrepare({id:id(),message_id:id(),name:'fixture.pdf',mime_type:'application/pdf',data_base64:bytes.toString('base64')});
const invalidPdf=e=>e.data.status===400&&e.data.code==='attachment_invalid'&&e.message==='PDF signature or ending mismatch';
test('private attachments: PDF header-only and genuine documents missing EOF are rejected',async()=>{
 assert.equal(pdf.subarray(-5).toString('ascii'),'%%EOF');
 await assert.rejects(preparePdf(Buffer.from('%PDF-1.7\n')),invalidPdf);
 await assert.rejects(preparePdf(pdf.subarray(0,-5)),invalidPdf);
});
test('private attachments: genuine PDF permits only the specified trailing whitespace and preserves bytes',async()=>{
 for(const suffix of [Buffer.alloc(0),Buffer.from([0,9,10,12,13,32])]){
  const bytes=Buffer.concat([pdf,suffix]),result=await preparePdf(bytes);
  assert.deepEqual(Buffer.from(result.bytes),bytes);
  assert.match(result.sha256,/^[a-f0-9]{64}$/);
 }
 for(const suffix of [Buffer.from([11]),Buffer.from([127]),Buffer.from('\ntrailing text')])await assert.rejects(preparePdf(Buffer.concat([pdf,suffix])),invalidPdf);
});
test('private attachments: complete PDF EOF marker must fit inside the final 1024 bytes',async()=>{
 const atBoundary=Buffer.concat([pdf,Buffer.alloc(1019,32)]);
 assert.deepEqual(Buffer.from((await preparePdf(atBoundary)).bytes),atBoundary);
 await assert.rejects(preparePdf(Buffer.concat([pdf,Buffer.alloc(1020,32)])),invalidPdf);
});
function seedIdentities(s,count,state='discarded',size=1){
 for(let i=0;i<count;i++)s.sql('INSERT INTO relay_owner_attachments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id(),id(),s.principal.principal,s.first.device_id,'synthetic.txt','text/plain',size,'0'.repeat(64),state==='discarded'?null:Buffer.from('x'),Date.now(),Date.now()+86400000,state,null);
}
test('private attachments: retained/staged/lifetime and daily quotas reject before PNG decoding',async t=>{
 const original=globalThis.DecompressionStream;let codec=0;t.mock.method(globalThis,'DecompressionStream',function(...args){codec++;return new original(...args);});
 for(const category of ['retained','staged','lifetime','dailyBytes','dailyCount']){
  const s=await attachmentFixture(t);
  if(category==='retained')seedIdentities(s,1,'linked',ATTACHMENT_LIMITS.retainedBytes);
  if(category==='staged')seedIdentities(s,128,'staged');
  if(category==='lifetime')seedIdentities(s,1024);
  if(category.startsWith('daily'))s.sql('INSERT INTO relay_owner_attachment_rates VALUES(?,?,?)',new Date().toISOString().slice(0,10),category==='dailyCount'?64:0,category==='dailyBytes'?ATTACHMENT_LIMITS.dailyBytes:0);
  const response=await output(await s.upload(id(),{mime_type:'image/png',data_base64:raster.png}));assert.equal(response.status,429,category);
  if(category==='lifetime')assert.match(response.body.error,/Discarding files does not reset/);
  assert.equal(s.sql("SELECT attempts FROM relay_owner_attachment_attempts WHERE bucket LIKE 'codec:day:%'")[0].attempts,1);
 }
 assert.equal(codec,0);
});
test('private attachments: quota races are rechecked after asynchronous preparation',async t=>{
 for(const quota of ['count','bytes']){
  const s=await attachmentFixture(t),day=new Date().toISOString().slice(0,10);
  s.sql('INSERT INTO relay_owner_attachment_rates VALUES(?,?,?)',day,quota==='count'?63:0,quota==='bytes'?ATTACHMENT_LIMITS.dailyBytes-Buffer.byteLength('Synthetic untrusted file.'):0);
  const responses=await Promise.all([s.upload(id()),s.upload(id())]);assert.deepEqual(responses.map(r=>r.status).sort(),[201,429],quota);
  assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_attachments')[0].n,1);
 }
});
test('private attachments: invalid codec work consumes attempts before inflation and is burst bounded',async t=>{
 const s=await attachmentFixture(t),original=globalThis.DecompressionStream;let codec=0;
 t.mock.method(globalThis,'DecompressionStream',function(...args){codec++;return new original(...args);});
 const bomb=pngImage(pngHeader(),[],Buffer.alloc(1048576)).toString('base64');
 for(let i=0;i<12;i++)assert.equal((await s.upload(id(),{mime_type:'image/png',data_base64:bomb})).status,400);
 assert.equal(codec,12);assert.equal((await s.upload(id(),{mime_type:'image/png',data_base64:bomb})).status,429);assert.equal(codec,12);
 assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_attachments')[0].n,0);
 assert.equal(s.sql("SELECT attempts FROM relay_owner_attachment_attempts WHERE bucket LIKE 'codec:day:%'")[0].attempts,12);
});
test('private attachments: daily failed-attempt allowance remains bounded across minute windows',async t=>{
 const s=await attachmentFixture(t),base=Math.floor(Date.now()/86400000)*86400000+8*3600000;let now=base;t.mock.method(Date,'now',()=>now);
 for(let i=0;i<128;i++){now=base+i*60000;assert.equal((await s.upload(id(),{data_base64:'a==='})).status,400);}
 now+=60000;assert.equal((await s.upload(id())).status,429);
 assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_attachment_attempts')[0].n,2);
});
+test('private attachments: UUID uploads and original messages are immutable and exactly idempotent',async t=>{
 const s=await attachmentFixture(t),message=id(),attachment=id(),opts={id:attachment};
 const a=await saved(await s.upload(message,opts));assert.equal((await s.upload(message,opts)).status,200);
 assert.equal((await s.upload(message,{id:attachment,data_base64:Buffer.from('Replacement').toString('base64')})).status,409);
 assert.equal((await s.upload(message,{id:attachment,name:'changed.txt'})).status,409);
 assert.equal((await s.send(message,[a.id])).status,201);assert.equal((await s.send(message,[a.id])).status,200);
 assert.equal((await s.send(message,[])).status,409);assert.equal((await s.send(message,[a.id],'Changed original body')).status,409);
 assert.equal((await s.upload(message)).status,409);
 const reply=await s.rpc('relay_owner_reply',{inbox_id:s.inbox,message_id:message,body:'Synthetic reply: completion remains unverified.'});
 assert.equal((await s.send(message,[a.id])).status,200);
 const conversation=await s.rpc('relay_owner_read_conversation',{inbox_id:s.inbox,message_id:message});
 assert.equal(conversation.reply.id,reply.entry.id);assert.equal(conversation.message.attachments.length,1);
 assert.equal(s.queued.length,1);assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_jobs')[0].n,1);assert.equal(s.sql('SELECT uploads FROM relay_owner_attachment_rates')[0].uploads,1);
});
test('private attachments: attachment-only messages work and attached job retries fail without losing context',async t=>{
 const s=await attachmentFixture(t),message=id(),a=await saved(await s.upload(message));
 assert.equal((await s.send(message,[a.id],'')).status,201);
 const before=s.sql('SELECT COUNT(*) AS n FROM relay_owner_entries')[0].n;
 const retry=await output(await s.store({op:'job_retry',token_hash:s.first.token_hash,job_id:message,id:id(),confirm_duplicate_risk:true}));
 assert.equal(retry.status,409);assert.equal(retry.body.code,'attachment_retry_unsupported');assert.match(retry.body.error,/Send a new message with the files again/);
 assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_entries')[0].n,before);
 assert.equal((await s.send(id(),[],'')).status,400);
});
test('private attachments: ordered IDs are unique, bounded and bound to uploader and original message',async t=>{
 const s=await attachmentFixture(t),message=id(),a=await saved(await s.upload(message)),second=await s.phone('Second synthetic phone');
 for(const ids of [[a.id,a.id],[...Array.from({length:5},id)],['not-a-uuid']])assert.equal((await s.send(message,ids)).status,400);
 assert.equal((await s.send(id(),[a.id])).status,404);assert.equal((await s.send(message,[a.id],'Request',second)).status,404);
 assert.equal((await s.send(message,[id()])).status,404);assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_entries')[0].n,0);
});
test('private attachments: expiry and disposal retain immutable UUID tombstones',async t=>{
 const s=await attachmentFixture(t),message=id(),attachment=id(),opts={id:attachment},a=await saved(await s.upload(message,opts));
 const discard={op:'attachment_discard',token_hash:s.first.token_hash,message_id:message,attachment_id:a.id};
 assert.equal((await s.store(discard)).status,201);assert.equal((await s.store(discard)).status,200);
 assert.equal((await s.upload(message,opts)).status,410);assert.equal((await s.upload(message,{...opts,name:'replacement.txt'})).status,409);
 assert.equal((await s.send(message,[a.id])).status,410);assert.equal(s.sql('SELECT bytes FROM relay_owner_attachments WHERE id=?',a.id)[0].bytes,null);
 const other=id(),b=await saved(await s.upload(other));const now=Date.now()+ATTACHMENT_LIMITS.draftMs;
 t.mock.method(Date,'now',()=>now);
 assert.equal((await s.send(other,[b.id])).status,410);
 assert.equal((await s.upload(other,{id:b.id})).status,410);
 assert.equal((await s.upload(id())).status,201);
 assert.equal(s.sql('SELECT state,bytes FROM relay_owner_attachments WHERE id=?',b.id)[0].state,'expired');
 assert.equal(s.sql('SELECT bytes FROM relay_owner_attachments WHERE id=?',b.id)[0].bytes,null);
});
test('private attachments: absent and foreign discard are indistinguishable; accepted attachments survive',async t=>{
 const s=await attachmentFixture(t),message=id(),a=await saved(await s.upload(message)),second=await s.phone();
 const absent=await output(await s.store({op:'attachment_discard',token_hash:s.first.token_hash,message_id:message,attachment_id:id()}));
 const wrongMessage=await output(await s.store({op:'attachment_discard',token_hash:s.first.token_hash,message_id:id(),attachment_id:a.id}));
 const wrongDevice=await output(await s.store({op:'attachment_discard',token_hash:second.token_hash,message_id:message,attachment_id:a.id}));
 assert.deepEqual(wrongMessage,absent);assert.deepEqual(wrongDevice,absent);
 assert.equal(s.sql('SELECT state FROM relay_owner_attachments WHERE id=?',a.id)[0].state,'staged');
 assert.equal((await s.send(message,[a.id])).status,201);
 assert.equal((await s.store({op:'attachment_discard',token_hash:s.first.token_hash,message_id:message,attachment_id:a.id})).status,409);
 assert.equal(s.sql('SELECT state FROM relay_owner_attachments WHERE id=?',a.id)[0].state,'linked');
});
test('private attachments: event failure atomically rolls back original message, file linkage, job and message quota',async t=>{
 const s=await attachmentFixture(t),message=id(),a=await saved(await s.upload(message));
 await assert.rejects(s.send(message,[a.id],'Request',s.first,()=>{throw Error('Synthetic enqueue failure');}),/Synthetic enqueue failure/);
 assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_entries')[0].n,0);
 assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_jobs')[0].n,0);
 assert.equal(s.sql("SELECT COUNT(*) AS n FROM relay_owner_meta WHERE key LIKE 'messages:%'")[0].n,0);
 assert.equal(s.sql('SELECT state FROM relay_owner_attachments WHERE id=?',a.id)[0].state,'staged');
 assert.equal((await s.send(message,[a.id])).status,201);
});
test('private attachments: racing identical uploads and sends create one record, job and event',async t=>{
 const s=await attachmentFixture(t),message=id(),attachment=id();
 const responses=await Promise.all([s.upload(message,{id:attachment}),s.upload(message,{id:attachment})]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);
 const sent=await Promise.all([s.send(message,[attachment]),s.send(message,[attachment])]);assert.deepEqual(sent.map(r=>r.status).sort(),[200,201]);
 assert.equal(s.queued.length,1);assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_attachments')[0].n,1);
 assert.equal(s.sql('SELECT uploads FROM relay_owner_attachment_rates')[0].uploads,1);
});
test('private attachments: racing replacements cannot overwrite bytes and concurrent message cap admits only four',async t=>{
 const s=await attachmentFixture(t),message=id(),attachment=id();
 const conflict=await Promise.all([s.upload(message,{id:attachment}),s.upload(message,{id:attachment,data_base64:Buffer.from('Different bytes').toString('base64')})]);
 assert.deepEqual(conflict.map(r=>r.status).sort(),[201,409]);
 const other=id(),responses=await Promise.all(Array.from({length:5},()=>s.upload(other)));
 assert.deepEqual(responses.map(r=>r.status).sort(),[201,201,201,201,429]);
 assert.equal(s.sql("SELECT COUNT(*) AS n FROM relay_owner_attachments WHERE message_id=? AND state='staged'",other)[0].n,4);
});
test('private attachments: discard/send order cannot erase or replace an accepted file',async t=>{
 for(const discardFirst of [false,true]){
  const s=await attachmentFixture(t),message=id(),a=await saved(await s.upload(message));
  const discard=()=>s.store({op:'attachment_discard',token_hash:s.first.token_hash,message_id:message,attachment_id:a.id});
  const responses=await Promise.all(discardFirst?[discard(),s.send(message,[a.id])]:[s.send(message,[a.id]),discard()]);
  assert.deepEqual(responses.map(r=>r.status),discardFirst?[201,410]:[201,409]);
  assert.equal(s.sql('SELECT state FROM relay_owner_attachments WHERE id=?',a.id)[0].state,discardFirst?'discarded':'linked');
 }
});
test('private attachments: revocation committed during hashing prevents binary persistence',async t=>{
 const s=await attachmentFixture(t),original=crypto.subtle.digest.bind(crypto.subtle);
 t.mock.method(crypto.subtle,'digest',async(...args)=>{s.sql('UPDATE relay_owner_sessions SET revoked_ms=? WHERE device_id=?',Date.now(),s.first.device_id);return original(...args);});
 assert.equal((await s.upload(id())).status,401);
 assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_attachments')[0].n,0);
 assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_attachment_rates')[0].n,0);
 assert.equal(s.sql("SELECT attempts FROM relay_owner_attachment_attempts WHERE bucket LIKE 'codec:day:%'")[0].attempts,1);
});
test('private attachments: invalid UTF-8, JSON, canonical base64, MIME and filenames fail before storage',async()=>{
 const base={id:id(),message_id:id(),name:'fixture.txt',mime_type:'text/plain',data_base64:Buffer.from('Synthetic').toString('base64')};
 const cases=[{data_base64:''},{data_base64:'a==='},{data_base64:'Zh=='},{data_base64:'Zg'},{data_base64:' Zg=='},{data_base64:Buffer.from([255]).toString('base64')},{mime_type:'text/html'},{mime_type:'image/svg+xml'},{mime_type:'application/javascript'},{mime_type:'image/png'},{mime_type:'application/pdf'},{mime_type:'application/json',data_base64:Buffer.from('{invalid').toString('base64')},...['../secret','a/b','a\\b','a\r\nheader','a\u202eb','\ud800','x'.repeat(241)].map(name=>({name}))];
 for(const change of cases)await assert.rejects(relayAttachmentPrepare({...base,...change}),e=>[400,415].includes(e.data.status));
 const tooLarge=Buffer.alloc(1048577,65).toString('base64');
 await assert.rejects(relayAttachmentPrepare({...base,data_base64:tooLarge}),e=>e.data.status===413);
});
test('private attachments: maximum file size is accepted and binary tampering fails integrity read',async t=>{
 const s=await attachmentFixture(t),message=id(),a=await saved(await s.upload(message,{data_base64:Buffer.alloc(1048576,65).toString('base64')}));
 assert.equal(a.sizeBytes,1048576);assert.equal((await s.send(message,[a.id])).status,201);
 s.sql('UPDATE relay_owner_attachments SET bytes=? WHERE id=?',Buffer.alloc(1048576,66),a.id);
 await assert.rejects(s.rpc('relay_owner_attachment_read',{inbox_id:s.inbox,message_id:message,attachment_id:a.id}),e=>e.data.status===503);
});
test('private attachments: upload/link/read verifies original bytes and metadata with no job completion',async t=>{
 const s=await attachmentFixture(t),message=id(),a=await saved(await s.upload(message));
 const sent=await s.send(message,[a.id]);assert.equal(sent.status,201);const entry=(await sent.json()).entry;
 assert.equal(entry.attachments[0].sha256,a.sha256);assert.equal(entry.attachments[0].state,'linked');assert.equal(s.queued.length,1);
 const read=await s.rpc('relay_owner_attachment_read',{inbox_id:s.inbox,message_id:message,attachment_id:a.id});
 assert.equal(Buffer.from(read.bytes).toString(),'Synthetic untrusted file.');assert.equal(read.attachment.sha256,a.sha256);
 const job=await s.rpc('relay_owner_job_read',{inbox_id:s.inbox,job_id:message});assert.equal(job.job.stage,'queued');assert.equal(job.job.completion,null);
});
for(const [mime,key] of [['image/png','png'],['image/jpeg','jpeg'],['image/webp','webp'],['image/webp','webpAlpha']])test('private attachments: genuine synthetic '+key+' bytes pass bounded validation',async()=>{
 const result=await relayAttachmentPrepare({id:id(),message_id:id(),name:'fixture.'+key,mime_type:mime,data_base64:raster[key]});assert.equal(result.bytes.length,Buffer.from(raster[key],'base64').length);assert.match(result.sha256,/^[a-f0-9]{64}$/);
});
