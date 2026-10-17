import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayOwnerApi,OWNER_SESSION_KEY,OwnerApiError} from '../public/assets/relay-owner-api.js';
import {createRelayOwnerController} from '../public/assets/relay-owner-ui.js';
import {createAttachmentDraft} from '../public/assets/relay-attachments.js';
import {attachmentMetadata,messageAttachments} from '../public/assets/relay-attachment-contract.js';
const deviceId=crypto.randomUUID(),messageId=crypto.randomUUID(),attachmentId=crypto.randomUUID(),token='a'.repeat(64);
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
const file=new File(['Synthetic private document.'],'fixture.txt',{type:'text/plain'});
const metadata=async(extra={})=>({id:attachmentId,messageId,name:file.name,mimeType:file.type,sizeBytes:file.size,sha256:await digest(await file.arrayBuffer()),createdAt:new Date().toISOString(),state:'staged',visibility:'private',...extra});
function fixture(fetcher){let saved=JSON.stringify({device_token:token,device_id:deviceId});const storage={getItem:key=>key===OWNER_SESSION_KEY?saved:null,setItem(){},removeItem(){saved=null;}};return createRelayOwnerApi({fetcher,storage,origin:'https://fixture.invalid'});}
test('private attachment API binds exact IDs and bytes, validates receipt, sends ordered IDs and fetches verified content',async()=>{
 const staged=await metadata(),linked={...staged,state:'linked'},calls=[];
 const api=fixture(async(url,options)=>{calls.push({url,options});assert.equal(options.headers.Authorization,'Bearer '+token);assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(url.includes(token),false);
  if(url.includes('/content?'))return new Response(await file.arrayBuffer(),{headers:{'Content-Type':'text/plain'}});
  const body=JSON.parse(options.body);if(url.endsWith('/attachments')){assert.deepEqual(body,{id:attachmentId,message_id:messageId,name:file.name,mime_type:file.type,data_base64:Buffer.from(await file.arrayBuffer()).toString('base64')});return Response.json({attachment:staged,newWrite:true,visibility:'private'});}
  assert.deepEqual(body,{id:messageId,body:'',attachment_ids:[attachmentId]});return Response.json({entry:{id:messageId,body:'',role:'user',visibility:'private',author_authenticated:true,createdAt:new Date().toISOString(),attachments:[linked]},newWrite:true});
 });
 assert.deepEqual(await api.uploadAttachment(messageId,attachmentId,file),staged);assert.deepEqual((await api.sendMessage(messageId,'',[attachmentId])).entry.attachments,[linked]);assert.equal(await (await api.attachmentContent(linked)).text(),await file.text());assert.equal(calls.length,3);
 await assert.rejects(api.attachmentContent(linked,{preview:true}),{kind:'attachment_invalid'});assert.equal(calls.length,3);
});
test('malformed receipts, mismatched content, unsupported metadata and authentication failure fail closed',async()=>{
 const valid=await metadata();const api=fixture(async()=>Response.json({attachment:{...valid,sha256:'0'.repeat(64)},newWrite:true,visibility:'private'}));await assert.rejects(api.uploadAttachment(messageId,attachmentId,file),{kind:'invalid'});
 for(const change of [{visibility:'public'},{mimeType:'text/html'},{name:'../secret'},{sizeBytes:1048577},{messageId:'foreign'}, {sha256:'bad'}])assert.throws(()=>attachmentMetadata({...valid,...change},{messageId}));
 assert.throws(()=>messageAttachments({id:messageId,role:'assistant',attachments:[{...valid,state:'linked'}]}));
 const corrupt=fixture(async()=>new Response('Different private bytes.',{headers:{'Content-Type':'text/plain'}}));await assert.rejects(corrupt.attachmentContent({...valid,state:'linked'}),{kind:'invalid'});
 const revoked=fixture(async()=>Response.json({code:'session_revoked'},{status:403}));await assert.rejects(revoked.uploadAttachment(messageId,attachmentId,file),{kind:'revoked'});assert.equal(revoked.hasCredential,false);
});
test('quota and type errors are safe actionable messages without response text',async()=>{
 for(const [code,status]of [['attachment_quota_exceeded',429],['attachment_type_unsupported',415]]){const api=fixture(async()=>Response.json({code,message:'private raw response must not display'},{status}));await assert.rejects(api.uploadAttachment(messageId,attachmentId,file),error=>error.kind===code&&!error.message.includes('private raw'));}
});
function controllerFixture({upload,send}={}){
 const sent=[],uploads=[],messages=[];const api={hasCredential:true,selectedMode:'owner',session:async()=>({device:{id:deviceId},attachments_enabled:true}),messages:async()=>({messages,nextCursor:null}),uploadAttachment:async(mid,id,selected,args)=>{uploads.push({mid,id});if(upload)return upload(mid,id,selected,args);return metadata({id,messageId:mid,name:selected.name,mimeType:selected.type,sizeBytes:selected.size});},sendMessage:async(id,body,ids)=>{const record={id,body,ids};sent.push(record);if(send)return send(record);return {};},discardAttachment:async()=>({})};
 const controller=createRelayOwnerController({api,draftStore:{read:()=>'',save:()=>true}});const draft=createAttachmentDraft({upload:(f,args)=>controller.uploadAttachment(args.messageId,args.id,f,args),onChange:s=>controller.setAttachmentCount(s.items.length)});controller.bindAttachments(()=>draft);return {controller,draft,sent,uploads};
}
test('attachment-only sends use reserved message identity and lost responses retry immutable body and files',async()=>{
 let attempts=0;const h=controllerFixture({send:async()=>{if(++attempts===1)throw new OwnerApiError('network');return {};}});await h.controller.refresh();await h.draft.add([file]);const reserved=h.draft.snapshot().messageId;await h.controller.send();assert.equal(h.sent[0].id,reserved);assert.equal(h.sent[0].body,'');assert.equal(h.controller.snapshot().sendUnconfirmed,true);assert.equal(h.draft.snapshot().locked,true);
 h.draft.remove(h.draft.snapshot().items[0].id);await h.draft.add([new File(['changed'],'changed.txt',{type:'text/plain'})]);assert.equal(h.draft.snapshot().items.length,1);h.controller.setDraft('Edited draft stays separate');await h.controller.send();assert.equal(h.sent.length,1);await h.controller.retryUnconfirmed();assert.deepEqual(h.sent[1],h.sent[0]);assert.equal(h.uploads.length,1);assert.equal(h.draft.snapshot().items.length,0);assert.equal(h.controller.snapshot().draft,'Edited draft stays separate');
});
test('removing an in-flight selected file cancels staging and cannot send a subset or empty message',async()=>{
 let resolve,signal;const h=controllerFixture({upload:async(mid,id,selected,args)=>{signal=args.signal;return new Promise(r=>resolve=async()=>r(await metadata({id,messageId:mid})));}});await h.controller.refresh();await h.draft.add([file]);const sending=h.controller.send();await new Promise(r=>setImmediate(r));h.draft.remove(h.draft.snapshot().items[0].id);assert.equal(signal.aborted,true);await resolve();await sending;assert.equal(h.sent.length,0);assert.equal(h.controller.snapshot().sendUnconfirmed,false);
});
test('session loss during file preparation sends no old draft and late private reads release no bytes',async()=>{
 let resolveFile,requests=0,saved=JSON.stringify({device_token:token,device_id:deviceId});const storage={getItem:key=>key===OWNER_SESSION_KEY?saved:null,setItem(){},removeItem(){saved=null;}};
 const api=createRelayOwnerApi({storage,fetcher:async()=>{requests++;throw Error('must not send');}});
 const pending=api.uploadAttachment(messageId,attachmentId,{name:file.name,type:file.type,size:file.size,arrayBuffer:()=>new Promise(resolve=>resolveFile=resolve)});saved=null;api.refreshStoredCredential();resolveFile(await file.arrayBuffer());await assert.rejects(pending,{kind:'unauthorized'});assert.equal(requests,0);
 let release;const body=new ReadableStream({start(controller){release=async()=>{controller.enqueue(new Uint8Array(await file.arrayBuffer()));controller.close();};}});saved=JSON.stringify({device_token:token,device_id:deviceId});const reader=createRelayOwnerApi({storage,fetcher:async()=>new Response(body,{headers:{'Content-Type':'text/plain'}})});const reading=reader.attachmentContent(await metadata({state:'linked'}));await new Promise(r=>setImmediate(r));saved=null;reader.refreshStoredCredential();await release();await assert.rejects(reading,{kind:'unauthorized'});
});
test('definitively expired staged files unlock for removal while transport failures retain immutable retries',async()=>{
 const h=controllerFixture({send:async()=>{throw new OwnerApiError('attachment_expired',410);}});await h.controller.refresh();await h.draft.add([file]);h.controller.setDraft('Preserve the unsent text');await h.controller.send();assert.equal(h.sent.length,1);assert.equal(h.controller.snapshot().sendUnconfirmed,false);assert.equal(h.draft.snapshot().locked,false);assert.equal(h.draft.snapshot().items[0].status,'error');assert.match(h.draft.snapshot().items[0].error,/expired/);h.draft.remove(h.draft.snapshot().items[0].id);assert.equal(h.draft.snapshot().items.length,0);assert.equal(h.controller.snapshot().draft,'Preserve the unsent text');
});

test('unknown post-submit errors cannot unlock the original attachment attempt',async()=>{const h=controllerFixture({send:async()=>{throw Error('Unknown response failure');}});await h.controller.refresh();await h.draft.add([file]);await h.controller.send();assert.equal(h.controller.snapshot().sendUnconfirmed,true);assert.equal(h.draft.snapshot().locked,true);});
