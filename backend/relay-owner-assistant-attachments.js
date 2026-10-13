// Assistant file bytes stay in the existing private attachment store. A later
// delivery is a separate immutable row, never an edit to an accepted reply.
import {RELAY_OWNER,RelayError,uuid,cursor} from './relay-common.js';
import {ATTACHMENT_LIMITS,ATTACHMENT_BODY_LIMIT} from './relay-owner-attachments.js';

export const ASSISTANT_DELIVERIES_PER_MESSAGE=32;
export const ASSISTANT_ATTACHMENT_MCP_BODY_LIMIT=ATTACHMENT_BODY_LIMIT+4096;
const rows=(ctx,q,...v)=>[...ctx.storage.sql.exec(q,...v)];
const fail=(status,code,message)=>{throw new RelayError(status===429?-32013:-32602,message,{status,code});};
const unavailable=()=>fail(404,'attachment_not_found','Private attachment not found');
const metadata=r=>({id:r.id,messageId:r.message_id,name:r.name,mimeType:r.mime_type,sizeBytes:r.size_bytes,sha256:r.sha256,createdAt:new Date(r.created_ms).toISOString(),state:r.state,visibility:'private'});
const source=principal=>'assistant:'+principal.grantId;
function identifiers(messageId,deliveryId,attachmentId){
 if(!uuid(messageId)||!uuid(deliveryId)||attachmentId!==undefined&&!uuid(attachmentId)||new Set([messageId,deliveryId,...(attachmentId===undefined?[]:[attachmentId])]).size!==(attachmentId===undefined?2:3))fail(400,'attachment_invalid','Invalid assistant attachment identifiers');
}
function original(ctx,messageId){
 const row=rows(ctx,"SELECT * FROM relay_owner_entries WHERE id=? AND kind='user' AND principal=?",messageId,RELAY_OWNER)[0];
 if(!row)unavailable();
 return row;
}
function target(ctx,principal,messageId,deliveryId){
 original(ctx,messageId);
 const existing=rows(ctx,'SELECT * FROM relay_owner_assistant_deliveries WHERE id=?',deliveryId)[0];
 if(existing){
  if(existing.message_id!==messageId||existing.principal!==RELAY_OWNER||existing.grant_id!==principal.grantId)unavailable();
  // Accepted provenance wins over a later identity alias admitted by an older
  // Worker. The commit still checks the exact immutable body and ordered files.
  return existing;
 }
 const bound=rows(ctx,'SELECT a.message_id,t.grant_id FROM relay_owner_assistant_attachment_targets t JOIN relay_owner_attachments a ON a.id=t.attachment_id WHERE t.delivery_id=? LIMIT 1',deliveryId)[0];
 if(bound&&(bound.message_id!==messageId||bound.grant_id!==principal.grantId))unavailable();
 if(rows(ctx,'SELECT id FROM relay_owner_entries WHERE id=?',deliveryId).length)fail(409,'attachment_delivery_conflict','Delivery ID conflicts with an existing private entry');
 if(rows(ctx,'SELECT id FROM relay_owner_attachments WHERE id=?',deliveryId).length)fail(409,'attachment_delivery_conflict','Delivery ID conflicts with an attachment');
 return existing;
}
function boundFile(ctx,principal,messageId,deliveryId,attachmentId){
 const r=rows(ctx,'SELECT a.*,t.delivery_id,t.grant_id FROM relay_owner_attachments a LEFT JOIN relay_owner_assistant_attachment_targets t ON t.attachment_id=a.id WHERE a.id=?',attachmentId)[0];
 if(r&&(r.principal!==RELAY_OWNER||r.device_id!==source(principal)||r.message_id!==messageId||r.delivery_id!==deliveryId||r.grant_id!==principal.grantId))unavailable();
 return r;
}
function quota(ctx,deliveryId,now,estimate){
 const usage=rows(ctx,"SELECT COUNT(*) AS records,COALESCE(SUM(CASE WHEN state='staged' AND expires_ms>? THEN 1 ELSE 0 END),0) AS staged,COALESCE(SUM(CASE WHEN state='linked' OR state='staged' AND expires_ms>? THEN size_bytes ELSE 0 END),0) AS bytes FROM relay_owner_attachments WHERE principal=?",now,now,RELAY_OWNER)[0];
 const count=rows(ctx,"SELECT COUNT(*) AS n FROM relay_owner_attachments a JOIN relay_owner_assistant_attachment_targets t ON t.attachment_id=a.id WHERE t.delivery_id=? AND a.principal=? AND a.state='staged' AND a.expires_ms>?",deliveryId,RELAY_OWNER,now)[0].n;
 const rate=rows(ctx,'SELECT uploads,bytes FROM relay_owner_attachment_rates WHERE day=?',new Date(now).toISOString().slice(0,10))[0];
 if(usage.records>=ATTACHMENT_LIMITS.recordsPerOwner)fail(429,'attachment_quota_exceeded','Private attachment lifetime limit reached (1,024 files). Discarding files does not reset this limit.');
 if(usage.staged>=ATTACHMENT_LIMITS.stagedPerOwner||count>=ATTACHMENT_LIMITS.perMessage||usage.bytes+estimate>ATTACHMENT_LIMITS.retainedBytes||(rate?.uploads||0)>=ATTACHMENT_LIMITS.uploadsPerDay||(rate?.bytes||0)+estimate>ATTACHMENT_LIMITS.dailyBytes)fail(429,'attachment_quota_exceeded','Private attachment quota reached');
}
export function relayAssistantAttachmentPrecheck(ctx,principal,args,now){
 identifiers(args.message_id,args.delivery_id,args.attachment_id);
 const accepted=target(ctx,principal,args.message_id,args.delivery_id);
 const previous=boundFile(ctx,principal,args.message_id,args.delivery_id,args.attachment_id);
 if(previous){
  if(previous.name!==args.name||previous.mime_type!==args.mime_type)fail(409,'attachment_id_conflict','Attachment ID conflicts with an existing upload');
  if(!['staged','linked'].includes(previous.state)||previous.state==='staged'&&previous.expires_ms<=now)fail(410,'attachment_expired','Attachment draft has expired or been discarded');
  return previous;
 }
 if(accepted)fail(409,'attachment_delivery_conflict','Accepted delivery attachments are immutable');
 if(rows(ctx,'SELECT id FROM relay_owner_entries WHERE id=?',args.attachment_id).length||rows(ctx,'SELECT id FROM relay_owner_assistant_deliveries WHERE id=?',args.attachment_id).length||rows(ctx,'SELECT delivery_id FROM relay_owner_assistant_attachment_targets WHERE delivery_id=? LIMIT 1',args.attachment_id).length)fail(409,'attachment_id_conflict','Attachment ID conflicts with a private entry or delivery');
 const encoded=args.data_base64,estimate=typeof encoded==='string'?Math.floor(encoded.length/4)*3-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0):0;
 quota(ctx,args.delivery_id,now,estimate);
 return null;
}
export function relayAssistantAttachmentUpload(ctx,principal,args,prepared,now){
 const previous=relayAssistantAttachmentPrecheck(ctx,principal,args,now);
 if(previous){
  if(previous.sha256!==prepared.sha256||previous.size_bytes!==prepared.bytes.length)fail(409,'attachment_id_conflict','Attachment ID conflicts with an existing upload');
  return {attachment:metadata(previous),newWrite:false,visibility:'private'};
 }
 quota(ctx,args.delivery_id,now,prepared.bytes.length);
 // Use the same global quota ledger and BLOB representation as phone uploads.
 rows(ctx,'INSERT INTO relay_owner_attachments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',args.attachment_id,args.message_id,RELAY_OWNER,source(principal),args.name,args.mime_type,prepared.bytes.length,prepared.sha256,prepared.bytes.buffer,now,now+ATTACHMENT_LIMITS.draftMs,'staged',null);
 rows(ctx,'INSERT INTO relay_owner_assistant_attachment_targets VALUES(?,?,?)',args.attachment_id,args.delivery_id,principal.grantId);
 const day=new Date(now).toISOString().slice(0,10);
 rows(ctx,'DELETE FROM relay_owner_attachment_rates WHERE day<>?',day);
 rows(ctx,'INSERT INTO relay_owner_attachment_rates VALUES(?,1,?) ON CONFLICT(day) DO UPDATE SET uploads=uploads+1,bytes=bytes+excluded.bytes',day,prepared.bytes.length);
 return {attachment:metadata(rows(ctx,'SELECT * FROM relay_owner_attachments WHERE id=?',args.attachment_id)[0]),newWrite:true,visibility:'private'};
}
export function relayAssistantAttachmentDiscard(ctx,principal,args,now){
 identifiers(args.message_id,args.delivery_id,args.attachment_id);
 original(ctx,args.message_id);
 let r;
 try{
  target(ctx,principal,args.message_id,args.delivery_id);
  r=boundFile(ctx,principal,args.message_id,args.delivery_id,args.attachment_id);
 }catch(error){if(error instanceof RelayError&&[404,409].includes(error.data?.status))return {discarded:true,newWrite:false,visibility:'private'};throw error;}
 if(!r){
  if(rows(ctx,'SELECT id FROM relay_owner_entries WHERE id=?',args.attachment_id).length||rows(ctx,'SELECT id FROM relay_owner_assistant_deliveries WHERE id=?',args.attachment_id).length||rows(ctx,'SELECT delivery_id FROM relay_owner_assistant_attachment_targets WHERE delivery_id=? LIMIT 1',args.attachment_id).length)return {discarded:true,newWrite:false,visibility:'private'};
  const count=rows(ctx,'SELECT COUNT(*) AS n FROM relay_owner_attachments WHERE principal=?',RELAY_OWNER)[0].n;
  if(count<ATTACHMENT_LIMITS.recordsPerOwner){
   rows(ctx,'INSERT INTO relay_owner_attachments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',args.attachment_id,args.message_id,RELAY_OWNER,source(principal),'','',0,'',null,now,now+ATTACHMENT_LIMITS.draftMs,'discarded',null);
   rows(ctx,'INSERT INTO relay_owner_assistant_attachment_targets VALUES(?,?,?)',args.attachment_id,args.delivery_id,principal.grantId);
  }
  return {discarded:true,newWrite:false,visibility:'private'};
 }
 if(r.state==='linked')fail(409,'attachment_already_linked','Accepted delivery attachments cannot be discarded');
 if(r.state!=='staged')return {discarded:true,newWrite:false,visibility:'private'};
 rows(ctx,"UPDATE relay_owner_attachments SET state='discarded',bytes=NULL WHERE id=?",r.id);
 return {discarded:true,newWrite:true,visibility:'private'};
}
export function relayAssistantAttachmentMetadata(ctx,deliveryId){
 return rows(ctx,"SELECT a.* FROM relay_owner_attachments a JOIN relay_owner_assistant_attachment_targets t ON t.attachment_id=a.id JOIN relay_owner_assistant_deliveries d ON d.id=t.delivery_id WHERE d.id=? AND a.message_id=d.message_id AND a.principal=d.principal AND a.state='linked' ORDER BY a.position",deliveryId).map(metadata);
}
function delivery(ctx,row){
 return {id:row.id,messageId:row.message_id,kind:row.kind,role:'assistant',body:row.body,createdAt:row.created_at,author_authenticated:true,principal:RELAY_OWNER,authentication_source:'owner-oauth-mcp',visibility:'private',attachments:relayAssistantAttachmentMetadata(ctx,row.id)};
}
export function relayAssistantDeliveryList(ctx,messageId,after,limit){
 if(!uuid(messageId))fail(400,'attachment_invalid','Invalid private original message ID');
 original(ctx,messageId);
 const offset=cursor(after)||0;
 if(limit!==undefined&&(!Number.isInteger(limit)||limit<1||limit>25))fail(400,'attachment_invalid','Invalid deliverable page size');
 const size=limit||10,selected=rows(ctx,"SELECT * FROM relay_owner_assistant_deliveries WHERE message_id=? AND principal=? AND kind='deliverable' AND seq>? ORDER BY seq LIMIT ?",messageId,RELAY_OWNER,offset,size+1);
 const page=selected.slice(0,size);
 return {message_id:messageId,deliverables:page.map(row=>delivery(ctx,row)),nextCursor:selected.length>size?String(page.at(-1).seq):null};
}
// One creation cursor across later deliveries, for chronological private chat.
// Original-owner linkage is checked again before any metadata leaves storage.
export function relayAssistantDeliveryFeed(ctx,after){
 const offset=cursor(after)||0;
 const selected=rows(ctx,"SELECT d.* FROM relay_owner_assistant_deliveries d JOIN relay_owner_entries u ON u.id=d.message_id AND u.kind='user' AND u.principal=d.principal WHERE d.principal=? AND d.kind='deliverable' AND d.seq>? ORDER BY d.seq LIMIT 51",RELAY_OWNER,offset);
 const page=selected.slice(0,50);
 return {updates:page.map(row=>({...delivery(ctx,row),sequence:row.seq})),nextCursor:selected.length>50?String(page.at(-1).seq):null,visibility:'private'};
}
export function relayAssistantDeliveryPrepare(ctx,principal,args,kind,now){
 identifiers(args.message_id,args.delivery_id);
 const accepted=target(ctx,principal,args.message_id,args.delivery_id);
 if(!['reply','deliverable'].includes(kind)||typeof args.body!=='string'||args.body.length>6000||!Array.isArray(args.attachment_ids)||args.attachment_ids.length<(kind==='reply'?1:0)||args.attachment_ids.length>4||!args.attachment_ids.length&&!args.body.trim()||args.attachment_ids.some(x=>!uuid(x)||x===args.delivery_id||x===args.message_id)||new Set(args.attachment_ids).size!==args.attachment_ids.length)fail(400,'attachment_invalid','Invalid assistant delivery');
 const body=args.body.trim();
 if(accepted){
  if(accepted.kind!==kind||accepted.body!==body||JSON.stringify(relayAssistantAttachmentMetadata(ctx,accepted.id).map(x=>x.id))!==JSON.stringify(args.attachment_ids))fail(409,'attachment_delivery_conflict','Delivery ID conflicts with an accepted immutable delivery');
  return {existing:delivery(ctx,accepted)};
 }
 if(kind==='reply'&&rows(ctx,"SELECT id FROM relay_owner_entries WHERE reply_to=? AND kind='reply'",args.message_id).length)fail(409,'attachment_reply_conflict','Private message already has an accepted reply; send a later deliverable');
 if(kind==='deliverable'&&rows(ctx,"SELECT COUNT(*) AS n FROM relay_owner_assistant_deliveries WHERE message_id=? AND principal=? AND kind='deliverable'",args.message_id,RELAY_OWNER)[0].n>=ASSISTANT_DELIVERIES_PER_MESSAGE)fail(429,'attachment_quota_exceeded','Private conversation deliverable limit reached (32)');
 for(const id of args.attachment_ids){
  const file=boundFile(ctx,principal,args.message_id,args.delivery_id,id);
  if(!file)unavailable();
  if(file.state!=='staged'||file.expires_ms<=now)fail(410,'attachment_expired','Attachment draft is unavailable');
 }
 return {body,message:original(ctx,args.message_id)};
}
export function relayAssistantDeliverySave(ctx,principal,args,kind,body,now){
 rows(ctx,'INSERT INTO relay_owner_assistant_deliveries(id,message_id,kind,body,created_at,principal,grant_id) VALUES(?,?,?,?,?,?,?)',args.delivery_id,args.message_id,kind,body,new Date(now).toISOString(),RELAY_OWNER,principal.grantId);
 args.attachment_ids.forEach((id,position)=>rows(ctx,"UPDATE relay_owner_attachments SET state='linked',position=? WHERE id=? AND message_id=? AND state='staged'",position,id,args.message_id));
 return {delivery:delivery(ctx,rows(ctx,'SELECT * FROM relay_owner_assistant_deliveries WHERE id=?',args.delivery_id)[0]),newWrite:true,visibility:'private'};
}
