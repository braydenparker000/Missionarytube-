import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture} from './helpers/relay-conversation-browser-fixture.js';
import {hash,random,RELAY_AGENT_SCOPE} from '../relay-common.js';
test('owner collaboration projection reads only shared messages/files; all writes and non-owner credentials rejected',async t=>{
 const muse=random(),h=createConversationFixture(t,{env:{RELAY_AGENTS_ENABLED:'true',RELAY_AGENT_LUCY_OAUTH_ENABLED:'true',RELAY_AGENT_MUSE_TOKEN_SHA256:await hash(muse)}});t.after(()=>h.close());const auth=await h.oauth(),owner=await h.pair(auth),lucy=await h.oauth(RELAY_AGENT_SCOPE),id=crypto.randomUUID(),file=crypto.randomUUID();
 await h.phone('/messages',{id:crypto.randomUUID(),body:'Owner-only excluded'},owner.device_token);
 await h.rpc(lucy,'relay_agent_file_upload',{id:file,message_id:id,name:'shared.txt',mime_type:'text/plain',data_base64:btoa('Shared fixture')});await h.rpc(lucy,'relay_agent_send',{id,body:'Deliberately shared',attachment_ids:[file]});
 for(const token of [undefined,random(),auth.access,lucy.access,muse])assert.equal((await h.phone('/collaboration',undefined,token)).status,401);
 assert.equal((await h.fixture.request('/relay/owner/collaboration',{headers:{Origin:'https://evil.example',Authorization:'Bearer '+owner.device_token}})).status,403);
 const response=await h.phone('/collaboration',undefined,owner.device_token);assert.equal(response.status,200);const data=await response.json();assert.equal(data.readOnly,true);assert.equal(data.messages.length,1);assert.equal(data.messages[0].id,id);assert.equal(data.messages[0].body,'Deliberately shared');assert.equal(data.messages[0].attachments[0].id,file);assert.ok(!JSON.stringify(data).includes('Owner-only excluded'));
 const bytes=await h.phone('/collaboration/files/content?message_id='+id+'&attachment_id='+file,undefined,owner.device_token);assert.equal(bytes.status,200);assert.equal(await bytes.text(),'Shared fixture');
 for(const path of ['/collaboration','/collaboration/files','/collaboration/files/discard'])assert.ok([404,405].includes((await h.phone(path,{id:crypto.randomUUID(),body:'Forbidden'},owner.device_token)).status));
 assert.equal((await h.phone('/collaboration?channel=owner',undefined,owner.device_token)).status,400);assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_agents_entries')[0].n,1);
 h.rows('UPDATE relay_owner_sessions SET principal=? WHERE device_id=?','github:another',owner.device.id);assert.equal((await h.phone('/collaboration',undefined,owner.device_token)).status,401);h.rows('UPDATE relay_owner_sessions SET principal=?,revoked_ms=1 WHERE device_id=?','github:183016859',owner.device.id);assert.equal((await h.phone('/collaboration',undefined,owner.device_token)).status,401);
});
test('collaboration pagination is bounded and attachment reads cannot reach private owner files',async t=>{
 const h=createConversationFixture(t,{env:{RELAY_AGENTS_ENABLED:'true',RELAY_AGENT_LUCY_OAUTH_ENABLED:'true',RELAY_AGENT_MUSE_TOKEN_SHA256:await hash(random())}});t.after(()=>h.close());const owner=await h.pair(await h.oauth()),lucy=await h.oauth(RELAY_AGENT_SCOPE),privateId=crypto.randomUUID(),privateFile=crypto.randomUUID();await h.phone('/attachments',{id:privateFile,message_id:privateId,name:'private.txt',mime_type:'text/plain',data_base64:btoa('Private owner bytes')},owner.device_token);await h.phone('/messages',{id:privateId,body:'Private',attachment_ids:[privateFile]},owner.device_token);
 for(let i=0;i<52;i++)await h.rpc(lucy,'relay_agent_send',{id:crypto.randomUUID(),body:'Shared '+i});
 const first=await (await h.phone('/collaboration',undefined,owner.device_token)).json();assert.equal(first.messages.length,50);assert.equal(first.nextCursor,'50');const next=await (await h.phone('/collaboration?after=50',undefined,owner.device_token)).json();assert.equal(next.messages.length,2);assert.equal(next.nextCursor,null);assert.equal(next.messages[0].sequence,51);
 assert.equal((await h.phone('/collaboration/files/content?message_id='+privateId+'&attachment_id='+privateFile,undefined,owner.device_token)).status,404);
 h.fixture.env.RELAY_AGENTS_ENABLED='false';assert.equal((await h.phone('/collaboration',undefined,owner.device_token)).status,503);
});
