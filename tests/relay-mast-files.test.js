import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture} from './helpers/relay-conversation-browser-fixture.js';
import {hash,random} from '../backend/relay-common.js';
import {mastAdapterStore} from '../backend/relay-mast.js';
import {relayOwnerStore} from '../backend/relay-owner.js';
const id=()=>crypto.randomUUID();
async function setup(t,enabled=true){
  const token=random(),env=enabled?{RELAY_MAST_ENABLED:'true',RELAY_MAST_TOKEN_SHA256:await hash(token)}:{};
  const h=createConversationFixture(t,{env});t.after(()=>h.close());const owner=await h.pair(await h.oauth());
  const mast=(path,body,credential=token)=>h.fixture.request('/relay/mast/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+credential},...(body?{body:JSON.stringify(body)}:{})});
  const phone=(path,body)=>h.phone('/mast'+path,body,owner.device_token);
  const file=(message_id,extra={})=>({id:id(),message_id,name:'synthetic.txt',mime_type:'text/plain',data_base64:Buffer.from('Synthetic private file.').toString('base64'),...extra});
  return {...h,owner,token,mast,phone,file};
}
const content=(message,file)=>'/files/content?message_id='+message+'&attachment_id='+file;

test('Mast files: staged/linked bytes, bidirectional isolation, immutable duplicates and safe documents',async t=>{
  const h=await setup(t),message=id(),file=h.file(message);
  assert.equal((await h.phone('/files',file)).status,201);
  assert.equal((await h.phone('/files',file)).status,200);
  assert.equal((await h.phone('/files',{...file,data_base64:Buffer.from('changed').toString('base64')})).status,409);
  assert.equal((await h.mast(content(message,file.id).slice(1))).status,404,'staged files are not readable by Mast');
  assert.equal((await h.phone(content(message,file.id))).status,404);
  const request={id:message,body:'',attachment_ids:[file.id]};
  assert.equal((await h.phone('',request)).status,201);assert.equal((await h.phone('',request)).status,200);
  assert.equal((await h.phone('',{...request,attachment_ids:[]})).status,400);
  const bytes=await h.mast(content(message,file.id).slice(1));assert.equal(bytes.status,200);assert.equal(await bytes.text(),'Synthetic private file.');assert.match(bytes.headers.get('content-disposition'),/^attachment;/);assert.match(bytes.headers.get('content-security-policy'),/sandbox/);
  assert.equal((await h.phone('/files/discard',{message_id:message,attachment_id:file.id})).status,409);
  assert.equal((await h.phone(content(message,file.id)+'&preview=1')).status,415);
  const reply=id(),out=h.file(reply,{reply_to:message,name:'reply.txt'});
  assert.equal((await h.mast('files',out)).status,201);
  assert.equal((await h.phone(content(reply,out.id))).status,404,'unpublished Mast bytes stay hidden');
  assert.equal((await h.mast('reply',{id:reply,reply_to:message,body:'',attachment_ids:[out.id]})).status,201);
  assert.equal((await h.mast('reply',{id:reply,reply_to:message,body:'',attachment_ids:[out.id]})).status,200);
  const replyBytes=await h.phone(content(reply,out.id));assert.equal(replyBytes.status,200);assert.equal(await replyBytes.text(),'Synthetic private file.');
  const lucy=id(),privateFile=h.file(lucy);await h.phone('',{id:id(),body:'text still works'});
  assert.equal((await h.fixture.request('/relay/owner/attachments',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://missionarytube.z13.web.core.windows.net',Authorization:'Bearer '+h.token},body:JSON.stringify(privateFile)})).status,401);
  assert.equal((await h.fixture.request('/relay/owner/attachments/content?message_id='+message+'&attachment_id='+file.id,{headers:{Authorization:'Bearer '+h.owner.device_token}})).status,404);
  assert.equal((await h.fixture.request('/relay/owner/attachments',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://missionarytube.z13.web.core.windows.net',Authorization:'Bearer '+h.owner.device_token},body:JSON.stringify(privateFile)})).status,201);
  assert.equal((await h.fixture.request('/relay/owner/messages',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://missionarytube.z13.web.core.windows.net',Authorization:'Bearer '+h.owner.device_token},body:JSON.stringify({id:lucy,body:'Lucy only',attachment_ids:[privateFile.id]})})).status,201);
  assert.equal((await h.mast(content(lucy,privateFile.id).slice(1))).status,404);
  assert.equal((await h.mast('files',h.file(id(),{reply_to:lucy}))).status,404);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_mast_entries')[0].n,3);
  const batch=id(),batchIds=[];for(let i=0;i<4;i++){const f=h.file(batch);batchIds.push(f.id);assert.equal((await h.phone('/files',f)).status,201);}
  assert.equal((await h.phone('/files',h.file(batch))).status,429,'four files per draft');
  const second=await h.pair(await h.oauth());assert.equal((await h.fixture.request('/relay/owner/mast',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://missionarytube.z13.web.core.windows.net',Authorization:'Bearer '+second.device_token},body:JSON.stringify({id:batch,body:'no',attachment_ids:batchIds})})).status,404,'another owner device cannot steal staged uploads');
  assert.equal((await h.phone('',{id:batch,body:'no',attachment_ids:[batchIds[0],batchIds[0]]})).status,400);

  h.rows('UPDATE relay_mast_files SET bytes=? WHERE id=?',new Uint8Array(Buffer.alloc(Buffer.from(file.data_base64,'base64').length,120)),file.id);
  assert.equal((await h.phone(content(message,file.id))).status,503,'corrupt stored bytes rejected');
});

test('Mast file cancellation, expiry, limits, owner revocation and token rotation during hashing fail closed',async t=>{
  const h=await setup(t),message=id(),file=h.file(message),original=crypto.subtle.digest.bind(crypto.subtle);
  let intervene=()=>{};t.mock.method(crypto.subtle,'digest',async(...args)=>{const out=await original(...args);await intervene();return out;});
  const ownerInput={...file,op:'mast_file_upload',token_hash:await hash(h.owner.device_token)};
  intervene=async()=>{intervene=()=>{};await relayOwnerStore(h.ctx,h.fixture.env,{op:'mast_file_discard',token_hash:ownerInput.token_hash,message_id:message,attachment_id:file.id});};
  const cancelled=await relayOwnerStore(h.ctx,h.fixture.env,ownerInput);assert.equal(cancelled.status,410);
  assert.equal(h.rows('SELECT bytes FROM relay_mast_files WHERE id=?',file.id)[0].bytes,null);
  const next=h.file(message);assert.equal((await h.phone('/files',next)).status,201);
  h.rows('UPDATE relay_mast_files SET expires_ms=0 WHERE id=?',next.id);
  assert.equal((await h.phone('',{id:message,body:'expired',attachment_ids:[next.id]})).status,410);
  assert.equal((await h.phone('/files',h.file(id(),{mime_type:'image/png'}))).status,400);
  assert.equal((await h.phone('/files',h.file(id(),{data_base64:Buffer.alloc(1048577).toString('base64')}))).status,413);
  const revoked=h.file(id());intervene=()=>{intervene=()=>{};h.rows('UPDATE relay_owner_sessions SET revoked_ms=1 WHERE device_id=?',h.owner.device.id);};
  assert.equal((await relayOwnerStore(h.ctx,h.fixture.env,{...revoked,op:'mast_file_upload',token_hash:ownerInput.token_hash})).status,401);
  assert.equal(h.rows('SELECT id FROM relay_mast_files WHERE id=?',revoked.id).length,0);
  const target=id();h.rows("INSERT INTO relay_mast_entries(id,role,body,created_at,device_id) VALUES(?,'owner','synthetic',?,'fixture')",target,new Date().toISOString());
  const outbound=h.file(id(),{reply_to:target});const tokenHash=await hash(h.token);
  intervene=()=>{intervene=()=>{};h.fixture.env.RELAY_MAST_TOKEN_SHA256='0'.repeat(64);};
  assert.equal((await mastAdapterStore(h.ctx,h.fixture.env,{...outbound,op:'file_upload',token_hash:tokenHash})).status,401);
  assert.equal(h.rows('SELECT id FROM relay_mast_files WHERE id=?',outbound.id).length,0);
});

test('Mast file endpoints remain closed without activation and never create storage',async t=>{
  const h=await setup(t,false);
  assert.equal((await h.phone('/files',h.file(id()))).status,503);
  assert.equal((await h.mast('files',h.file(id(),{reply_to:id()}))).status,503);
  assert.deepEqual(h.rows("SELECT name FROM sqlite_master WHERE name LIKE 'relay_mast_%'"),[]);
});
