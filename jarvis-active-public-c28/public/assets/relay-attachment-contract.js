// Shared frontend bounds. The private service still validates bytes and access.
export const RELAY_ATTACHMENT_TYPES=Object.freeze(['image/png','image/jpeg','image/webp','application/pdf','text/plain','text/markdown','text/csv','application/json']);
export const RELAY_ATTACHMENT_MAX_BYTES=1048576;
export const attachmentUuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export const attachmentFilename=value=>typeof value==='string'&&!!value.trim()&&value===value.trim()&&new TextEncoder().encode(value).length<=240&&!['.','..'].includes(value)&&!/[\u0000-\u001f\u007f-\u009f/\\\u202a-\u202e\u2066-\u2069]/.test(value);
export function attachmentMetadata(value,{messageId,state}={}){
  if(!value||!attachmentUuid(value.id)||!attachmentUuid(value.messageId)||messageId&&value.messageId!==messageId
    ||!attachmentFilename(value.name)
    ||!RELAY_ATTACHMENT_TYPES.includes(value.mimeType)||!Number.isSafeInteger(value.sizeBytes)||value.sizeBytes<1||value.sizeBytes>RELAY_ATTACHMENT_MAX_BYTES
    ||typeof value.sha256!=='string'||! /^[a-f0-9]{64}$/.test(value.sha256)||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))
    ||!['staged','linked'].includes(value.state)||state&&value.state!==state||value.visibility!=='private')throw Error('Invalid attachment metadata');
  return {id:value.id,messageId:value.messageId,name:value.name,mimeType:value.mimeType,sizeBytes:value.sizeBytes,sha256:value.sha256,createdAt:value.createdAt,state:value.state,visibility:'private'};
}
export function messageAttachments(entry){
  if(entry.attachments===undefined)return [];
  if(!Array.isArray(entry.attachments)||entry.attachments.length>4)throw Error('Invalid message attachments');
  if(entry.attachments.length&&entry.role!=='user'&&(entry.role!=='assistant'||entry.visibility!=='private'||entry.author_authenticated!==true
    ||entry.principal!=='github:183016859'||entry.authentication_source!=='owner-oauth-mcp'||!attachmentUuid(entry.replyTo)||entry.replyTo===entry.id))throw Error('Invalid assistant attachment provenance');
  const items=entry.attachments.map(item=>attachmentMetadata(item,{messageId:entry.role==='assistant'?entry.replyTo:entry.id,state:'linked'}));
  if(new Set(items.map(item=>item.id)).size!==items.length)throw Error('Duplicate attachments');return items;
}

export function assistantDeliverable(value,messageId){
  if(!value||value.role!=='assistant'||value.kind!=='deliverable'||value.messageId!==messageId||!attachmentUuid(value.id)||value.id===messageId
    ||typeof value.body!=='string'||value.body.length>6000||!Number.isFinite(Date.parse(value.createdAt))||!Array.isArray(value.attachments)||!value.attachments.length)throw Error('Invalid private deliverable');
  const attachments=messageAttachments({...value,replyTo:messageId});
  return {id:value.id,messageId,kind:'deliverable',role:'assistant',body:value.body,createdAt:value.createdAt,attachments};
}
