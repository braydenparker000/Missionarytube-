import test from 'node:test';
import assert from 'node:assert/strict';
import {messageAttachments,assistantDeliverable} from '../public/assets/relay-attachment-contract.js';
import {createRelayOwnerApi,OWNER_SESSION_KEY} from '../public/assets/relay-owner-api.js';
import {createRelayOwnerController} from '../public/assets/relay-owner-ui.js';
const originalId=crypto.randomUUID(),replyId=crypto.randomUUID(),deliveryId=crypto.randomUUID(),deviceId=crypto.randomUUID();
const metadata={id:crypto.randomUUID(),messageId:originalId,name:'Synthetic report.pdf',mimeType:'application/pdf',sizeBytes:20,sha256:'a'.repeat(64),createdAt:'2026-10-10T18:00:02Z',state:'linked',visibility:'private'};
const delivery={id:deliveryId,sequence:3,role:'assistant',body:'',createdAt:metadata.createdAt,replyTo:originalId,visibility:'private',author_authenticated:true,principal:'github:183016859',authentication_source:'owner-oauth-mcp',attachments:[metadata]};
const original={id:originalId,sequence:1,role:'user',body:'Synthetic report request',createdAt:'2026-10-10T18:00:00Z',visibility:'private',author_authenticated:true};
const reply={...delivery,id:replyId,sequence:2,body:'Accepted text reply remains unchanged.',createdAt:'2026-10-10T18:00:01Z',attachments:[]};
const token='a'.repeat(64),storage={getItem:key=>key===OWNER_SESSION_KEY?JSON.stringify({device_token:token,device_id:deviceId}):null};
test('text updates retain private authenticated provenance even without files',()=>{
 const update={...delivery,messageId:originalId,kind:'deliverable',body:'Synthetic progress',attachments:[]};
 assert.equal(assistantDeliverable(update,originalId).body,update.body);
 for(const change of [{body:'   '},{visibility:'public'},{author_authenticated:false},{principal:'github:other'},{authentication_source:'shared'}])assert.throws(()=>assistantDeliverable({...update,...change},originalId));
});
test('private assistant file metadata requires authenticated owner MCP provenance and exact delivery linkage',()=>{
 assert.deepEqual(messageAttachments(delivery),[metadata]);
 for(const change of [{role:'system'},{visibility:'public'},{author_authenticated:false},{principal:'github:other'},{authentication_source:'owner-device-session'},{replyTo:null},{replyTo:deliveryId},{attachments:[{...metadata,messageId:replyId}]},{attachments:[metadata,metadata]}])assert.throws(()=>messageAttachments({...delivery,...change}));
});
test('owner message API accepts authenticated assistant files and rejects foreign or public metadata',async()=>{
 let response=delivery;const api=createRelayOwnerApi({storage,fetcher:async()=>Response.json({messages:[response],nextCursor:null})});
 assert.deepEqual((await api.messages()).messages[0].attachments,[metadata]);
 for(const change of [{visibility:'public'},{authentication_source:'shared'},{attachments:[{...metadata,visibility:'public'}]}]){response={...delivery,...change};await assert.rejects(api.messages(),{kind:'invalid'});}
});
test('later file pagination keeps the accepted text reply separate and ignores a late response after clear',async()=>{
 let resolve;const api={hasCredential:true,selectedMode:'owner',session:async()=>({device:{id:deviceId},attachments_enabled:true}),messages:async()=>({messages:[original,reply],nextCursor:null}),refreshStoredCredential(){this.hasCredential=false;},deliverables:async()=>new Promise(r=>resolve=r)};
 const controller=createRelayOwnerController({api,draftStore:{read:()=>'',save:()=>true}});await controller.refresh();const reading=controller.loadDeliverables(originalId);
 controller.closeDeliverables(originalId);resolve({deliverables:[{...delivery,messageId:originalId,kind:'deliverable'}],nextCursor:null});await reading;
 assert.equal(controller.snapshot().deliveryPages[originalId]?.items.length??0,0);
});

test('later deliverable API enforces original linkage, provenance, unique IDs and advancing bounded cursors',async()=>{
 const valid={...delivery,messageId:originalId,kind:'deliverable'};let data={message_id:originalId,visibility:'private',deliverables:[valid],nextCursor:'10'};
 const api=createRelayOwnerApi({storage,fetcher:async()=>Response.json(data)});assert.equal((await api.deliverables(originalId)).deliverables[0].id,deliveryId);
 const baseline=structuredClone(data);
 for(const change of [{message_id:replyId},{visibility:'public'},{nextCursor:'0'},{nextCursor:'bad'},{deliverables:[]},{deliverables:[valid,valid]},{deliverables:[{...valid,role:'user'}]},{deliverables:[{...valid,messageId:replyId}]},{deliverables:[{...valid,authentication_source:'shared'}]}]){data={...baseline,...change};await assert.rejects(api.deliverables(originalId),{kind:'invalid'});}
});
test('later delivery reads preserve loaded files on error and reject late auth-loss responses',async()=>{
 let mode='ok',resolve;const file={...delivery,messageId:originalId,kind:'deliverable'};const api={hasCredential:true,selectedMode:'owner',session:async()=>({device:{id:deviceId},attachments_enabled:true}),messages:async()=>({messages:[original,reply],nextCursor:null}),refreshStoredCredential(){this.hasCredential=false;},deliverables:async()=>{if(mode==='error')throw Error('Synthetic offline');if(mode==='hold')return new Promise(r=>resolve=r);return {deliverables:[file],nextCursor:null};}};
 const controller=createRelayOwnerController({api,draftStore:{read:()=>'',save:()=>true}});await controller.refresh();await controller.loadDeliverables(originalId);mode='error';await controller.loadDeliverables(originalId);assert.equal(controller.snapshot().deliveryPages[originalId].items.length,1);assert.match(controller.snapshot().deliveryPages[originalId].error,/Could not load/);assert.equal(controller.snapshot().messages.find(m=>m.id===replyId).body,reply.body);
 mode='hold';const pending=controller.loadDeliverables(originalId);controller.storedSessionChanged();resolve({deliverables:[file],nextCursor:null});await pending;assert.deepEqual(controller.snapshot().deliveryPages,{});
});

test('refresh rejects changed immutable delivery records and preserves the entire loaded cache',async()=>{
 const first={...delivery,messageId:originalId,kind:'deliverable'},second={...first,id:crypto.randomUUID(),body:'Previously loaded second page'};let response={deliverables:[first],nextCursor:'10'};
 const api={hasCredential:true,selectedMode:'owner',session:async()=>({device:{id:deviceId},attachments_enabled:true}),messages:async()=>({messages:[original,reply],nextCursor:null}),deliverables:async()=>response};
 const controller=createRelayOwnerController({api,draftStore:{read:()=>'',save:()=>true}});await controller.refresh();await controller.loadDeliverables(originalId);response={deliverables:[second],nextCursor:null};await controller.loadDeliverables(originalId,{more:true});const accepted=controller.snapshot().deliveryPages[originalId];
 for(const changed of [{...first,body:'Changed original delivery'},{...second,attachments:[{...metadata,name:'Changed filename.pdf'}]}]){response={deliverables:[changed],nextCursor:'10'};await controller.loadDeliverables(originalId);const page=controller.snapshot().deliveryPages[originalId];assert.deepEqual(page.items,accepted.items);assert.equal(page.nextCursor,accepted.nextCursor);assert.ok(page.error);assert.equal(controller.snapshot().messages.find(m=>m.id===replyId).body,reply.body);}
});
