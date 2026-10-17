import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {prepareRelayAssistantFile} from '../scripts/relay-assistant-file-args.mjs';
import {assistantFixture,id,raster} from './helpers/relay-assistant-attachment-fixture.js';
test('assistant byte bridge: genuine available image/PDF bytes form actual flat MCP arguments and private deliveries',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'relay-assistant-files-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const s=await assistantFixture(t),message=id();await s.send(message);
 const pdf=JSON.parse(readFileSync(new URL('./fixtures/relay-attachment-document.json',import.meta.url))).pdf;
 for(const [name,data] of [['synthetic.png',raster.png],['synthetic.pdf',pdf]]){
  const path=join(directory,name),bytes=Buffer.from(data,'base64'),delivery=id();await writeFile(path,bytes);
  const prepared=await prepareRelayAssistantFile({filePath:path,messageId:message,deliveryId:delivery,attachmentId:id()});
  assert.equal(prepared.arguments.data_base64,data);assert.equal(prepared.sizeBytes,bytes.length);
  assert.equal(Object.hasOwn(prepared.arguments,'filePath'),false);assert.equal(Object.hasOwn(prepared.arguments,'url'),false);
  const uploaded=(await s.connector(prepared.tool,prepared.arguments)).structuredContent;
  assert.equal(uploaded.attachment.sha256,prepared.sha256);await s.commit(message,delivery,[uploaded.attachment]);
  const download=await s.http('/attachments/content?message_id='+message+'&attachment_id='+uploaded.attachment.id);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
 }
});
test('assistant byte bridge: unsupported, empty, oversized and invalid-ID inputs cannot form delivery arguments',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'relay-assistant-bounds-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const args={messageId:id(),deliveryId:id(),attachmentId:id()};
 for(const [name,bytes] of [['empty.txt',Buffer.alloc(0)],['large.txt',Buffer.alloc(1048577)],['executable.svg',Buffer.from('<svg/>')]]){
  const path=join(directory,name);await writeFile(path,bytes);await assert.rejects(prepareRelayAssistantFile({...args,filePath:path}));
 }
 const valid=join(directory,'synthetic.txt');await writeFile(valid,'Synthetic file');
 await assert.rejects(prepareRelayAssistantFile({...args,filePath:valid,deliveryId:args.messageId}));
 await assert.rejects(prepareRelayAssistantFile({...args,filePath:directory}));
});
