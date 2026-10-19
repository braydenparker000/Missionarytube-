import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture} from './helpers/relay-conversation-browser-fixture.js';
import {boardStore} from '../relay-board.js';
import {random} from '../relay-common.js';
const id=()=>crypto.randomUUID();
async function setup(t){const h=createConversationFixture(t,{env:{RELAY_BOARD_ENABLED:'true'}});t.after(()=>h.close());const oauth=await h.oauth(),owner=await h.pair(oauth);const object=h.fixture.object('jarvis-relay-oauth-v1');return {...h,oauth,owner,object};}
test('owner board ingress rejects missing credentials, cross-origin, forged provenance and unknown fields',async t=>{
 const h=await setup(t);for(const token of [undefined,random(),h.oauth.access])assert.equal((await h.phone('/board',undefined,token)).status,401);
 const empty=await h.phone('/board',undefined,h.owner.device_token);assert.equal(empty.status,200);assert.equal((await empty.json()).active,false);
 assert.equal((await h.fixture.request('/relay/owner/board/messages',{method:'POST',headers:{Origin:'https://evil.example',Authorization:'Bearer '+h.owner.device_token,'Content-Type':'application/json'},body:JSON.stringify({id:id(),body:'No'})})).status,403);
 for(const extra of [{identity:'owner'},{authority:'owner'},{attachments:[]},{principal:'github:183016859'}])assert.equal((await h.phone('/board/messages',{id:id(),body:'No',...extra},h.owner.device_token)).status,400);
 assert.equal((await h.phone('/board?channel=makima',undefined,h.owner.device_token)).status,400);
 h.fixture.env.RELAY_BOARD_ENABLED='false';assert.equal((await h.phone('/board',undefined,h.owner.device_token)).status,503);
});
test('owner board text, lookup, replies, tasks and revocation use authenticated routes',async t=>{
 const h=await setup(t);const obj=[...h.fixture.objects.values()].find(o=>o.db.prepare("SELECT name FROM sqlite_master WHERE name='relay_owner_sessions'").get());
 const connections=['lucy','mast','makima'].map(agent=>({agent,connection_id:'fixture-'+agent}));
 boardStore(obj.ctx,{op:'activate',args:{id:id(),confirm:true,duration_days:365,members:connections}},()=>({agent:'owner',authenticationSource:'owner-device-session',actor:'fixture-owner',verifiedConnections:connections}));
 const args={id:id(),body:'Future owner message',result_links:['https://example.test/result']};const response=await h.phone('/board/messages',args,h.owner.device_token);assert.equal(response.status,200);const data=await response.json();assert.equal(data.entry.identity,'owner');assert.equal(data.entry.authority,'owner');
 assert.equal((await (await h.phone('/board/message?message_id='+args.id,undefined,h.owner.device_token)).json()).entry.body,args.body);
 assert.equal((await h.phone('/board/message?message_id='+id(),undefined,h.owner.device_token)).status,404);
 assert.equal((await h.phone('/board/messages',{id:id(),body:'Reply',reply_to:args.id},h.owner.device_token)).status,200);
 assert.equal((await h.phone('/board/tasks',{id:id(),title:'Review',body:'Shared only',assignee:'makima'},h.owner.device_token)).status,200);
 assert.equal((await (await h.phone('/board/tasks',undefined,h.owner.device_token)).json()).tasks.length,1);
 const members=(await (await h.phone('/board',undefined,h.owner.device_token)).json()).members;
 assert.equal((await h.phone('/board/revoke',{membership_id:members[0].id,confirm:true},h.owner.device_token)).status,200);
 assert.equal((await h.phone('/board/messages',{...args,body:'Mutated'},h.owner.device_token)).status,409);
});
test('owner rebind route verifies exact live candidate and returns immutable recovery operation',async t=>{
 const h=await setup(t);const obj=[...h.fixture.objects.values()].find(o=>o.db.prepare("SELECT name FROM sqlite_master WHERE name='relay_owner_sessions'").get());
 const connections=['lucy','mast','makima'].map(agent=>({agent,connection_id:'fixture-'+agent}));boardStore(obj.ctx,{op:'activate',args:{id:id(),confirm:true,duration_days:365,members:connections}},()=>({agent:'owner',authenticationSource:'owner-device-session',actor:'fixture-owner',verifiedConnections:connections}));
 h.fixture.env.RELAY_AGENTS_ENABLED='true';h.fixture.env.RELAY_AGENT_LUCY_OAUTH_ENABLED='true';h.fixture.env.RELAY_AGENT_MUSE_TOKEN_SHA256='c'.repeat(64);
 const candidates=await (await h.phone('/board/connections',undefined,h.owner.device_token)).json(),candidate=candidates.connections.find(x=>x.agent==='mast');assert.equal(candidate.connection_type,'mast-muse-profile');
 const before=(await (await h.phone('/board',undefined,h.owner.device_token)).json()).members.find(x=>x.agent==='mast');const args={id:id(),agent:'mast',current_membership_id:before.id,connection_id:candidate.connection_id,confirm:true};
 const response=await h.phone('/board/rebind',args,h.owner.device_token);assert.equal(response.status,200);const data=await response.json();assert.equal(data.membership.operationId,args.id);assert.notEqual(data.membership.id,before.id);assert.equal(data.membership.expiresAt,before.expiresAt);
 assert.equal((await (await h.phone('/board/rebind',args,h.owner.device_token)).json()).newWrite,false);
 assert.equal((await h.phone('/board/rebind',{...args,id:id()},h.owner.device_token)).status,409);
});
