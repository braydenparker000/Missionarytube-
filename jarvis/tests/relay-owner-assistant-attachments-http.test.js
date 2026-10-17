import test from 'node:test';
import assert from 'node:assert/strict';
import {assistantFixture,id} from './helpers/relay-assistant-attachment-fixture.js';
import {relayConnector} from '../backend/relay-connector.js';
import {ASSISTANT_ATTACHMENT_MCP_BODY_LIMIT} from '../backend/relay-owner-assistant-attachments.js';
test('assistant MCP HTTP: actual file bytes above the old envelope limit stage and deliver through owner tools',async t=>{
 const s=await assistantFixture(t),message=id(),delivery=id();await s.send(message);
 const bytes=Buffer.alloc(1048576,65),args=s.uploadArgs(message,delivery,{data_base64:bytes.toString('base64')});
 const response=await s.mcp('relay_owner_attachment_upload',args);assert.equal(response.status,200);
 const uploaded=await response.json();assert.equal(uploaded.error,undefined);assert.equal(uploaded.result.structuredContent.attachment.sizeBytes,bytes.length);assert.equal(JSON.stringify(uploaded).includes(args.data_base64),false);
 const file=uploaded.result.structuredContent.attachment,commit=s.commitArgs(message,delivery,[file]);
 const accepted=await(await s.mcp('relay_owner_deliverable_send',commit)).json();assert.equal(accepted.result.structuredContent.delivery.id,delivery);
 const download=await s.http('/attachments/content?message_id='+message+'&attachment_id='+file.id);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
 const retry=await(await s.mcp('relay_owner_deliverable_send',commit)).json();assert.equal(retry.result.structuredContent.newWrite,false);
 assert.equal(s.sql("SELECT attempts FROM relay_owner_attachment_attempts WHERE bucket LIKE 'ingress:day:%'")[0].attempts,1);
});
test('assistant MCP HTTP: missing, revoked and narrowed owner authorization cannot read a large upload body',async t=>{
 for(const category of ['unknown','revoked','narrowed']){
  const s=await assistantFixture(t);let reads=0;
  if(category!=='unknown'){
   const key='grant:'+s.principal.grantId,row=s.sql('SELECT value FROM relay_oauth WHERE key=?',key)[0],value=JSON.parse(row.value);
   if(category==='revoked')value.revoked=true;else value.scope='relay:read relay:reply';
   s.sql('UPDATE relay_oauth SET value=? WHERE key=?',JSON.stringify(value),key);
  }
  const request=s.mcpRequest('relay_owner_attachment_upload',s.uploadArgs(id(),id()),{...(category==='unknown'?{token:'0'.repeat(64)}:{})});
  t.mock.method(request.body,'getReader',()=>{reads++;throw Error('Unauthorized body read');});
  const response=await relayConnector(request,s.env);assert.equal(response.status,category==='narrowed'?403:401);
  assert.equal(reads,0);assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_attachment_attempts')[0].n,0);
 }
});
test('assistant MCP HTTP: ingress allowance is charged before parsing and rejects further bodies without reading',async t=>{
 const s=await assistantFixture(t);
 for(let i=0;i<12;i++)assert.equal((await s.mcp('relay_owner_attachment_upload',{}, {body:'{bad JSON'})).status,400);
 let reads=0;const request=s.mcpRequest('relay_owner_attachment_upload',{});
 t.mock.method(request.body,'getReader',()=>{reads++;throw Error('Rate-limited body read');});
 assert.equal((await relayConnector(request,s.env)).status,429);assert.equal(reads,0);
 assert.equal(s.sql("SELECT attempts FROM relay_owner_attachment_attempts WHERE bucket LIKE 'ingress:day:%'")[0].attempts,12);
 assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_attachments')[0].n,0);
});
test('assistant MCP HTTP: upload and ordinary envelopes are bounded, and mismatched tool headers cannot widen a call',async t=>{
 const s=await assistantFixture(t),message=id();await s.send(message);
 const args=s.uploadArgs(message,id(),{data_base64:'A'.repeat(ASSISTANT_ATTACHMENT_MCP_BODY_LIMIT)});
 assert.equal((await s.mcp('relay_owner_attachment_upload',args)).status,413);
 assert.equal((await s.mcp('relay_owner_read_conversation',{inbox_id:s.inbox,message_id:message,padding:'x'.repeat(30001)})).status,413);
 const mismatch=await s.mcp('relay_owner_deliverable_send',s.commitArgs(message,id(),[id()]),{headers:{'Mcp-Name':'relay_owner_attachment_upload'}});
 assert.equal(mismatch.status,400);assert.equal((await mismatch.json()).error.message,'Header mismatch');
 assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_assistant_deliveries')[0].n,0);
});
