// Local byte-to-tool-argument bridge. No credentials, network or Relay writes.
import {open} from 'node:fs/promises';
import {basename,extname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {RELAY_OWNER_INBOX,uuid} from '../backend/relay-common.js';
import {ATTACHMENT_MAX_BYTES,relayAttachmentPrepare} from '../backend/relay-owner-attachments.js';
const mimeByExtension={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.pdf':'application/pdf','.txt':'text/plain','.md':'text/markdown','.csv':'text/csv','.json':'application/json'};
export async function prepareRelayAssistantFile({filePath,messageId,deliveryId,attachmentId,mimeType,name}){
 if(typeof filePath!=='string'||!filePath||![messageId,deliveryId,attachmentId].every(uuid)||new Set([messageId,deliveryId,attachmentId]).size!==3)throw Error('Supply a local file and distinct original message, delivery and attachment UUIDs');
 const file=await open(filePath,'r');
 let bytes;
 try{
  const stat=await file.stat();
  if(!stat.isFile()||stat.size<1||stat.size>ATTACHMENT_MAX_BYTES)throw Error('Private assistant file must be a regular nonempty file of at most 1 MiB');
  // A file changing after stat cannot cause an unbounded allocation/read.
  const buffer=Buffer.alloc(ATTACHMENT_MAX_BYTES+1);let size=0;
  for(;;){const {bytesRead}=await file.read(buffer,size,buffer.length-size,size);size+=bytesRead;if(size>ATTACHMENT_MAX_BYTES)throw Error('Private assistant file exceeds 1 MiB');if(!bytesRead)break;}
  bytes=buffer.subarray(0,size);
 }finally{await file.close();}
 const args={inbox_id:RELAY_OWNER_INBOX,message_id:messageId,delivery_id:deliveryId,attachment_id:attachmentId,name:name??basename(filePath),mime_type:mimeType??mimeByExtension[extname(filePath).toLowerCase()],data_base64:bytes.toString('base64')};
 const validated=await relayAttachmentPrepare({id:args.attachment_id,message_id:args.message_id,name:args.name,mime_type:args.mime_type,data_base64:args.data_base64});
 return {tool:'relay_owner_attachment_upload',arguments:args,sha256:validated.sha256,sizeBytes:validated.bytes.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [filePath,messageId,deliveryId,attachmentId,mimeType,...extra]=process.argv.slice(2);
  if(extra.length)throw Error('Usage: node scripts/relay-assistant-file-args.mjs <file> <original UUID> <delivery UUID> <attachment UUID> [MIME]');
  process.stdout.write(JSON.stringify(await prepareRelayAssistantFile({filePath,messageId,deliveryId,attachmentId,mimeType})));
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
