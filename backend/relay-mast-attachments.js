// Mast-only file storage. Reuse Relay's byte validators and safe response headers;
// never route Mast authority through owner attachment storage or owner OAuth.
import {RelayError,uuid,fields,json} from './relay-common.js';
import {ATTACHMENT_LIMITS as limits,ATTACHMENT_MAX_BYTES,relayAttachmentPrepare,relayAttachmentVerify,relayAttachmentDownload} from './relay-owner-attachments.js';
const rows=(ctx,q,...v)=>[...ctx.storage.sql.exec(q,...v)];
const fail=(status,code,message)=>{throw new RelayError(-32602,message,{status,code});};
const missing=()=>fail(404,'attachment_not_found','Mast file not found');
export function mastFileSchema(ctx){
  ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS relay_mast_files (
    id TEXT PRIMARY KEY,message_id TEXT NOT NULL,reply_to TEXT,actor TEXT NOT NULL,
    name TEXT NOT NULL,mime_type TEXT NOT NULL,size_bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,
    bytes BLOB,created_ms INTEGER NOT NULL,expires_ms INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('staged','linked','discarded','expired')),position INTEGER)`);
  ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS relay_mast_file_message ON relay_mast_files(message_id,state,position)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS relay_mast_file_rates (bucket TEXT PRIMARY KEY,attempts INTEGER NOT NULL,uploads INTEGER NOT NULL,bytes INTEGER NOT NULL)');
}
const metadata=r=>({id:r.id,messageId:r.message_id,name:r.name,mimeType:r.mime_type,sizeBytes:r.size_bytes,sha256:r.sha256,createdAt:new Date(r.created_ms).toISOString(),state:r.state,visibility:'private'});
function cleanup(ctx,now){rows(ctx,"UPDATE relay_mast_files SET state='expired',bytes=NULL WHERE state='staged' AND expires_ms<=?",now);}
function admit(ctx,now,phase){
  mastFileSchema(ctx);const day=new Date(now).toISOString().slice(0,10),buckets=[phase+':'+day,phase+':'+Math.floor(now/60000)];
  for(const [i,bucket]of buckets.entries())if((rows(ctx,'SELECT attempts FROM relay_mast_file_rates WHERE bucket=?',bucket)[0]?.attempts||0)>=(i?limits.attemptsPerMinute:limits.attemptsPerDay))fail(429,'attachment_quota_exceeded','Mast file attempt allowance reached');
  rows(ctx,'DELETE FROM relay_mast_file_rates WHERE bucket LIKE ? AND bucket NOT IN (?,?)',phase+':%',...buckets);
  for(const bucket of buckets)rows(ctx,'INSERT INTO relay_mast_file_rates VALUES(?,1,0,0) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1',bucket);
  cleanup(ctx,now);
}
function ids(body){if(!uuid(body.message_id)||!uuid(body.id)||body.id===body.message_id)fail(400,'attachment_invalid','Invalid Mast file IDs');}
function target(ctx,body,actor){
  ids(body);
  if(actor.startsWith('mast:')){
    if(!uuid(body.reply_to)||body.reply_to===body.message_id||!rows(ctx,"SELECT id FROM relay_mast_entries WHERE id=? AND role='owner'",body.reply_to).length)missing();
    if(rows(ctx,'SELECT id FROM relay_mast_entries WHERE reply_to=? AND id<>?',body.reply_to,body.message_id).length)fail(409,'attachment_message_conflict','Mast message already has a reply');
  }else if(body.reply_to!==undefined)fail(400,'attachment_invalid','Owner files cannot select a reply target');
}
function precheck(ctx,body,actor,now){
  target(ctx,body,actor);
  const prior=rows(ctx,'SELECT * FROM relay_mast_files WHERE id=?',body.id)[0];
  if(prior){
    if(prior.actor!==actor||prior.message_id!==body.message_id)missing();
    if(['discarded','expired'].includes(prior.state))fail(410,'attachment_expired','Mast file draft expired or discarded');
    if(prior.reply_to!==(body.reply_to??null))missing();
    if(prior.name!==body.name||prior.mime_type!==body.mime_type)fail(409,'attachment_id_conflict','Mast file ID conflict');
    if(!['staged','linked'].includes(prior.state)||prior.state==='staged'&&prior.expires_ms<=now)fail(410,'attachment_expired','Mast file draft expired or discarded');
    return prior;
  }
  if(rows(ctx,'SELECT id FROM relay_mast_entries WHERE id IN (?,?)',body.message_id,body.id).length
    ||rows(ctx,'SELECT id FROM relay_mast_files WHERE id=? OR message_id=?',body.message_id,body.id).length)fail(409,'attachment_message_conflict','Mast message or file ID already reserved');
  const reserved=rows(ctx,"SELECT actor,reply_to FROM relay_mast_files WHERE message_id=? AND state IN ('staged','linked') LIMIT 1",body.message_id)[0];
  if(reserved&&(reserved.actor!==actor||reserved.reply_to!==(body.reply_to??null)))missing();
  const usage=rows(ctx,"SELECT COUNT(*) AS records,COALESCE(SUM(state='staged'),0) AS staged,COALESCE(SUM(CASE WHEN state IN ('staged','linked') THEN size_bytes ELSE 0 END),0) AS bytes FROM relay_mast_files")[0];
  const count=rows(ctx,"SELECT COUNT(*) AS n FROM relay_mast_files WHERE message_id=? AND state='staged'",body.message_id)[0].n;
  const rate=rows(ctx,'SELECT * FROM relay_mast_file_rates WHERE bucket=?','bytes:'+new Date(now).toISOString().slice(0,10))[0];
  const estimate=typeof body.data_base64==='string'?Math.floor(body.data_base64.length/4)*3-(body.data_base64.endsWith('==')?2:body.data_base64.endsWith('=')?1:0):0;
  if(usage.records>=limits.recordsPerOwner||usage.staged>=limits.stagedPerOwner||count>=limits.perMessage||usage.bytes+estimate>limits.retainedBytes||(rate?.uploads||0)>=limits.uploadsPerDay||(rate?.bytes||0)+estimate>limits.dailyBytes)fail(429,'attachment_quota_exceeded','Mast file quota reached');
}
export function mastFileMetadata(ctx,messageId){mastFileSchema(ctx);return rows(ctx,"SELECT id,message_id,name,mime_type,size_bytes,sha256,created_ms,state FROM relay_mast_files WHERE message_id=? AND state='linked' ORDER BY position",messageId).map(metadata);}
export function mastFileCheckMessage(ctx,messageId,input,actor,replyTo,now,previous){
  mastFileSchema(ctx);const list=input??[];
  if(!Array.isArray(list)||list.length>limits.perMessage||list.some(id=>!uuid(id))||new Set(list).size!==list.length)fail(400,'attachment_invalid','Invalid Mast message files');
  if(previous){if(JSON.stringify(mastFileMetadata(ctx,messageId).map(a=>a.id))!==JSON.stringify(list))fail(409,'attachment_message_conflict','Mast message files are immutable');return list;}
  if(rows(ctx,'SELECT id FROM relay_mast_files WHERE id=?',messageId).length)fail(409,'attachment_id_conflict','Mast message ID is a file ID');
  const reserved=rows(ctx,"SELECT actor,reply_to FROM relay_mast_files WHERE message_id=? AND state IN ('staged','linked') LIMIT 1",messageId)[0];
  if(reserved&&(reserved.actor!==actor||reserved.reply_to!==replyTo))missing();
  for(const id of list){const r=rows(ctx,'SELECT * FROM relay_mast_files WHERE id=?',id)[0];
    if(!r||r.actor!==actor||r.message_id!==messageId||r.reply_to!==replyTo)missing();
    if(r.state!=='staged'||r.expires_ms<=now)fail(410,'attachment_expired','Mast file draft unavailable');
  }return list;
}
export function mastFileLink(ctx,messageId,list){list.forEach((id,i)=>rows(ctx,"UPDATE relay_mast_files SET state='linked',position=? WHERE id=? AND message_id=? AND state='staged'",i,id,messageId));}
function read(ctx,body){
  if(!uuid(body.message_id)||!uuid(body.attachment_id))missing();
  if(body.preview!==undefined&&typeof body.preview!=='boolean')fail(400,'attachment_invalid','Invalid preview');
  if(!rows(ctx,'SELECT id FROM relay_mast_entries WHERE id=?',body.message_id).length)missing();
  const r=rows(ctx,"SELECT * FROM relay_mast_files WHERE id=? AND message_id=? AND state='linked'",body.attachment_id,body.message_id)[0];
  if(!r?.bytes)missing();const bytes=new Uint8Array(r.bytes instanceof ArrayBuffer?r.bytes:new Uint8Array(r.bytes));
  if(bytes.length!==r.size_bytes||bytes.length>ATTACHMENT_MAX_BYTES)fail(503,'attachment_unavailable','Mast file integrity unavailable');
  return {attachment:metadata(r),bytes};
}
export async function mastFileOperation(ctx,input,authorize){
  const allowed={file_admit:[],file_upload:['id','message_id','reply_to','name','mime_type','data_base64'],file_discard:['message_id','attachment_id'],file_content:['message_id','attachment_id','preview']};
  fields(input,['op','token_hash',...(allowed[input.op]||[])],['op','token_hash',...(allowed[input.op]||[]).filter(k=>!['reply_to','preview'].includes(k))]);
  const check=()=>{const actor=authorize();mastFileSchema(ctx);return actor;};
  if(input.op==='file_admit'){ctx.storage.transactionSync(()=>{check();admit(ctx,Date.now(),'ingress');});return json({admitted:true});}
  if(input.op==='file_upload'){
    const actor=ctx.storage.transactionSync(()=>{const actor=check();admit(ctx,Date.now(),'codec');return actor;});
    precheck(ctx,input,actor,Date.now());const prepared=await relayAttachmentPrepare(input);
    return ctx.storage.transactionSync(()=>{
      const current=check();if(current!==actor)missing();const now=Date.now();cleanup(ctx,now);const prior=precheck(ctx,input,actor,now);
      if(prior){if(prior.sha256!==prepared.sha256||prior.size_bytes!==prepared.bytes.length)fail(409,'attachment_id_conflict','Mast file bytes conflict');return json({attachment:metadata(prior),newWrite:false,visibility:'private'});}
      rows(ctx,'INSERT INTO relay_mast_files VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',input.id,input.message_id,input.reply_to??null,actor,input.name,input.mime_type,prepared.bytes.length,prepared.sha256,prepared.bytes.buffer,now,now+limits.draftMs,'staged',null);
      const day='bytes:'+new Date(now).toISOString().slice(0,10);rows(ctx,"DELETE FROM relay_mast_file_rates WHERE bucket LIKE 'bytes:%' AND bucket<>?",day);
      rows(ctx,'INSERT INTO relay_mast_file_rates VALUES(?,0,1,?) ON CONFLICT(bucket) DO UPDATE SET uploads=uploads+1,bytes=bytes+excluded.bytes',day,prepared.bytes.length);
      return json({attachment:metadata(rows(ctx,'SELECT * FROM relay_mast_files WHERE id=?',input.id)[0]),newWrite:true,visibility:'private'},201);
    });
  }
  if(input.op==='file_content'){
    const actor=check(),verified=await relayAttachmentVerify(read(ctx,input));
    return ctx.storage.transactionSync(()=>{if(check()!==actor)missing();return relayAttachmentDownload(verified,input.preview);});
  }
  if(input.op==='file_discard'){ctx.storage.transactionSync(()=>{check();admit(ctx,Date.now(),'discard');});return ctx.storage.transactionSync(()=>{
    const actor=check(),now=Date.now();if(!uuid(input.message_id)||!uuid(input.attachment_id))missing();
    const r=rows(ctx,'SELECT * FROM relay_mast_files WHERE id=?',input.attachment_id)[0];
    if(!r){
      const reserved=rows(ctx,"SELECT actor FROM relay_mast_files WHERE message_id=? AND state IN ('staged','linked') LIMIT 1",input.message_id)[0];
      const collision=input.attachment_id===input.message_id||rows(ctx,'SELECT id FROM relay_mast_entries WHERE id IN (?,?)',input.attachment_id,input.message_id).length||rows(ctx,'SELECT id FROM relay_mast_files WHERE message_id=? OR id=?',input.attachment_id,input.message_id).length;
      if(!collision&&(!reserved||reserved.actor===actor)&&rows(ctx,'SELECT COUNT(*) AS n FROM relay_mast_files')[0].n<limits.recordsPerOwner)rows(ctx,'INSERT INTO relay_mast_files VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',input.attachment_id,input.message_id,null,actor,'','',0,'',null,now,now+limits.draftMs,'discarded',null);
    }
    else if(r.actor===actor&&r.message_id===input.message_id){if(r.state==='linked')fail(409,'attachment_already_linked','Accepted Mast files cannot be discarded');rows(ctx,"UPDATE relay_mast_files SET state='discarded',bytes=NULL WHERE id=?",r.id);}
    return json({discarded:true,visibility:'private'});
  });}
  fail(400,'attachment_invalid','Invalid Mast file operation');
}
