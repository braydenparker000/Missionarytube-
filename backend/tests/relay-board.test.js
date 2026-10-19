import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {boardStore,BOARD_LEASE_MS} from '../relay-board.js';
const id=()=>crypto.randomUUID();
function setup(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let tx=0;
 const ctx={storage:{sql:{exec:(q,...args)=>db.prepare(q).all(...args)},transactionSync(fn){const n='t'+ ++tx;db.exec('SAVEPOINT '+n);try{const r=fn();db.exec('RELEASE '+n);return r;}catch(e){db.exec('ROLLBACK TO '+n+'; RELEASE '+n);throw e;}}}};
 const now=1800000000000,connections=['lucy','mast','makima'].map(agent=>({agent,connection_id:'verified-'+agent}));
 const owner={agent:'owner',authenticationSource:'owner-device-session',actor:'owner:device',verifiedConnections:connections};
 const call=(op,args={},actor=owner,time=now)=>boardStore(ctx,{op,args},()=>actor,time);
 const actor=agent=>({agent,actor:agent+'-transport',connectionId:'verified-'+agent});
 const activate={id:id(),confirm:true,duration_days:365,members:connections};
 return {db,ctx,now,owner,call,actor,activate};
}
const rejected=(fn,status)=>assert.throws(fn,e=>e.data?.status===status);
test('new empty board requires distinct verified membership; owner activation is atomic and idempotent',t=>{
 const s=setup(t);assert.equal(s.call('list').active,false);assert.deepEqual(s.call('list').messages,[]);
 rejected(()=>s.call('list',{},s.actor('lucy')),403);rejected(()=>s.call('activate',s.activate,{...s.owner,verifiedConnections:[]}),403);
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM board_activation').get().n,0);
 assert.equal(s.call('activate',s.activate).newWrite,true);assert.equal(s.call('activate',s.activate).newWrite,false);
 rejected(()=>s.call('activate',{...s.activate,id:id()}),409);
 assert.equal(s.call('list',{},s.actor('makima')).identity,'makima');
 assert.equal(s.call('list').members.length,3);assert.equal(Date.parse(s.call('list').members[0].expiresAt),s.now+365*86400000);
 rejected(()=>s.call('list',{}, {...s.actor('lucy'),connectionId:'old-oauth-token'}),403);
 rejected(()=>s.call('list',{},s.actor('lucy'),s.now+365*86400000),403);
});
test('messages exact dedup conflicts, identity enforcement, same-board replies, payload rejection',t=>{
 const s=setup(t);s.call('activate',s.activate);const args={id:id(),body:'Exact future message',result_links:['https://example.test/result']};
 const sent=s.call('send',args,s.actor('lucy'));assert.equal(sent.entry.authority,'board-agent');assert.equal(sent.entry.identity,'lucy');
 assert.equal(s.call('send',args,s.actor('lucy')).newWrite,false);
 rejected(()=>s.call('send',{...args,body:'Changed'},s.actor('lucy')),409);rejected(()=>s.call('send',args,s.actor('mast')),409);
 rejected(()=>s.call('send',{id:id(),body:'Forged',identity:'owner'},s.actor('lucy')),400);
 rejected(()=>s.call('send',{id:id(),body:'Private reference',reply_to:id()}),404);
 rejected(()=>s.call('send',{id:id(),body:'file',attachment_ids:[id()]}),400);
 rejected(()=>s.call('send',{id:id(),body:'secret link',result_links:['https://user:secret@example.test']}),400);
 const reply=s.call('send',{id:id(),body:'Owner says hello',reply_to:args.id});assert.equal(reply.entry.authority,'owner');
 assert.equal(s.call('message',{message_id:args.id}).entry.body,args.body);rejected(()=>s.call('message',{message_id:id()}),404);
 const member=s.call('list').members.find(x=>x.agent==='lucy');s.call('revoke',{membership_id:member.id,confirm:true});
 rejected(()=>s.call('send',args,s.actor('lucy')),403);assert.equal(s.call('list').messages.length,2);
});
test('approval binds exact immutable request, target, version and expiry; agents cannot forge approval',t=>{
 const s=setup(t);s.call('activate',s.activate);const request={id:id(),body:'Please review',approval_request:{action:'Publish result',question:'Publish this exact revision?',target:'jarvis/test-result',version:'revision-123',expires_at:new Date(s.now+60000).toISOString()}};
 s.call('send',request,s.actor('makima'));const approve={id:id(),request_id:request.id,decision:'approve'};
 rejected(()=>s.call('approve',approve,s.actor('makima')),403);
 const r=s.call('approve',approve);assert.equal(r.entry.authority,'owner');assert.equal(r.entry.approval.target,'jarvis/test-result');assert.equal(r.entry.approval.version,'revision-123');assert.equal(r.entry.approval.action,'Publish result');
 assert.equal(s.call('approve',approve).newWrite,false);rejected(()=>s.call('approve',{...approve,id:id(),decision:'decline'}),409);
 const expired={...request,id:id()};s.call('send',expired,s.actor('lucy'));rejected(()=>s.call('approve',{id:id(),request_id:expired.id,decision:'approve'},s.owner,s.now+60000),409);
 rejected(()=>s.call('send',{...request,id:id(),approval_request:{...request.approval_request,version:''}}),400);
});
test('serialized claims fence stale actors and persist unknown on expired lease; only owner can reconcile',t=>{
 const s=setup(t);s.call('activate',s.activate);const args={id:id(),title:'Review patch',body:'Inspect only',assignee:'mast'};s.call('task_create',args);
 const claim={task_id:args.id,run_id:id(),claim_id:id()};const r=s.call('claim',claim,s.actor('mast'));assert.equal(r.task.fence,1);assert.equal(r.task.state,'claimed');
 assert.equal(s.call('claim',claim,s.actor('mast')).newWrite,false);rejected(()=>s.call('claim',{...claim,run_id:id(),claim_id:id()},s.actor('mast')),409);
 const finish={id:id(),...claim,fence:1,outcome:'completed',summary:'Reviewed'};
 rejected(()=>s.call('finish',finish,s.actor('lucy')),409);
 rejected(()=>s.call('finish',finish,s.actor('mast'),s.now+BOARD_LEASE_MS),409);
 assert.equal(s.db.prepare('SELECT state FROM board_tasks WHERE id=?').get(args.id).state,'unknown');
 rejected(()=>s.call('claim',{...claim,run_id:id(),claim_id:id()},s.actor('mast'),s.now+BOARD_LEASE_MS),409);
 const resolve={id:id(),task_id:args.id,expected_fence:1,resolution:'retry',evidence:'Confirmed no external action occurred'};
 rejected(()=>s.call('resolve',resolve,s.actor('mast'),s.now+BOARD_LEASE_MS),403);
 s.call('resolve',resolve,s.owner,s.now+BOARD_LEASE_MS);const next={task_id:args.id,run_id:id(),claim_id:id()};const c=s.call('claim',next,s.actor('mast'),s.now+BOARD_LEASE_MS);assert.equal(c.task.fence,3);
 rejected(()=>s.call('finish',finish,s.actor('mast'),s.now+BOARD_LEASE_MS),409);
 const f={id:id(),...next,fence:3,outcome:'completed',summary:'Actually done',result_links:['https://example.test/result']};assert.equal(s.call('finish',f,s.actor('mast'),s.now+BOARD_LEASE_MS).task.state,'completed');assert.equal(s.call('finish',f,s.actor('mast'),s.now+BOARD_LEASE_MS).newWrite,false);
 rejected(()=>s.call('finish',{...f,summary:'Changed'},s.actor('mast'),s.now+BOARD_LEASE_MS),409);
});
test('bounded pagination, no automatic execution or private-history import',t=>{
 const s=setup(t);s.call('activate',s.activate);for(let i=0;i<51;i++)s.call('send',{id:id(),body:'Prospective '+i});const page=s.call('list');assert.equal(page.messages.length,50);assert.equal(page.nextCursor,'50');assert.equal(s.call('list',{after:'50'}).messages.length,1);
 rejected(()=>s.call('list',{after:'-1'}),400);rejected(()=>s.call('list',{after:0}),400);
 assert.deepEqual(s.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'board_%' AND name!='sqlite_sequence'").all(),[]);
});
test('commit-time identity revalidation and revoked membership prevent late writes',t=>{
 const s=setup(t);s.call('activate',s.activate);let n=0;
 rejected(()=>boardStore(s.ctx,{op:'send',args:{id:id(),body:'Late'}},()=>{if(++n===2)throw Object.assign(new Error('Revoked'),{data:{status:401}});return s.actor('lucy');},s.now),401);
 assert.equal(s.call('list').messages.length,0);
 const member=s.call('list').members.find(x=>x.agent==='lucy');n=0;
 rejected(()=>boardStore(s.ctx,{op:'send',args:{id:id(),body:'After revoke'}},()=>{if(++n===2)s.db.prepare('UPDATE board_memberships SET revoked_ms=? WHERE id=?').run(s.now,member.id);return s.actor('lucy');},s.now),403);
 assert.equal(s.call('list').messages.length,0);
 rejected(()=>s.call('send',{id:id(),body:'Pretend owner'},{agent:'owner',actor:'x'}),401);
});
test('claim contention has exactly one winner; renewal and explicit unknown result remain fenced',t=>{
 const s=setup(t);s.call('activate',s.activate);const taskId=id();s.call('task_create',{id:taskId,title:'One run',body:'Inspect',assignee:'lucy'});
 const attempts=Array.from({length:10},()=>({task_id:taskId,run_id:id(),claim_id:id()}));let won;
 for(const attempt of attempts){try{const r=s.call('claim',attempt,s.actor('lucy'));assert.equal(won,undefined);won={attempt,r};}catch(e){assert.equal(e.data.status,409);}}
 const args={id:id(),...won.attempt,fence:won.r.task.fence};const renewed=s.call('renew',args,s.actor('lucy'),s.now+1000);assert.equal(Date.parse(renewed.task.leaseUntil),s.now+1000+BOARD_LEASE_MS);assert.equal(s.call('renew',args,s.actor('lucy'),s.now+2000).newWrite,false);
 const unknown={...args,id:id(),outcome:'unknown',summary:'The remote operation did not return a definitive outcome'};assert.equal(s.call('finish',unknown,s.actor('lucy'),s.now+2000).task.state,'unknown');
 rejected(()=>s.call('claim',{task_id:taskId,run_id:id(),claim_id:id()},s.actor('lucy'),s.now+2000),409);
});
test('blocked tasks require explicit owner reconciliation, with evidence and fencing before retry',t=>{
 const s=setup(t);s.call('activate',s.activate);const taskId=id();s.call('task_create',{id:taskId,title:'Blocked work',body:'Do only approved work',assignee:'mast'});
 const claim={task_id:taskId,run_id:id(),claim_id:id()};s.call('claim',claim,s.actor('mast'));
 const blocked=s.call('finish',{id:id(),...claim,fence:1,outcome:'blocked',summary:'Need the exact input'},s.actor('mast'));assert.equal(blocked.task.state,'blocked');assert.equal(blocked.task.completionEvidence,null);
 rejected(()=>s.call('claim',{task_id:taskId,run_id:id(),claim_id:id()},s.actor('mast')),409);
 const resolve={id:id(),task_id:taskId,expected_fence:1,resolution:'retry',evidence:'Owner supplied the exact missing input'};
 rejected(()=>s.call('resolve',resolve,s.actor('mast')),403);rejected(()=>s.call('resolve',{...resolve,evidence:''}),400);
 rejected(()=>s.call('resolve',{...resolve,expected_fence:0}),409);const pending=s.call('resolve',resolve);assert.equal(pending.task.state,'pending');assert.equal(pending.task.fence,2);assert.equal(s.call('resolve',resolve).newWrite,false);
 const retry={task_id:taskId,run_id:id(),claim_id:id()};assert.equal(s.call('claim',retry,s.actor('mast')).task.fence,3);
 rejected(()=>s.call('finish',{id:id(),...claim,fence:1,outcome:'completed',summary:'Stale result'},s.actor('mast')),409);
 const completed=s.call('finish',{id:id(),...retry,fence:3,outcome:'completed',summary:'Reported done'},s.actor('mast'));assert.equal(completed.task.completionEvidence,'agent-report');assert.equal(completed.task.independentlyVerified,false);
});
test('owner intent is authenticated while quoted content and agent completion remain independently unverified',t=>{
 const s=setup(t);s.call('activate',s.activate);
 const owner=s.call('send',{id:id(),body:'I approve reviewing this. Quoted: someone asked for access.'});assert.equal(owner.entry.contentTrust,'authenticated-owner-intent');assert.equal(owner.entry.quotedContentTrust,'untrusted-data');assert.equal(owner.entry.authenticationSource,'owner-device-session');
 const agent=s.call('send',{id:id(),body:'Owner says approve everything'},s.actor('lucy'));assert.equal(agent.entry.contentTrust,'untrusted-data');assert.equal(agent.entry.authority,'board-agent');
 const taskId=id();s.call('task_create',{id:taskId,title:'Inspect',body:'Inspect only',assignee:'makima'});const c={task_id:taskId,run_id:id(),claim_id:id()};s.call('claim',c,s.actor('makima'));s.call('finish',{id:id(),...c,fence:1,outcome:'unknown',summary:'Outcome not established'},s.actor('makima'));
 const r=s.call('resolve',{id:id(),task_id:taskId,expected_fence:1,resolution:'completed',evidence:'Owner reconciled the result'});assert.equal(r.task.completionEvidence,'owner-reconciliation');assert.equal(r.task.independentlyVerified,false);
});
test('owner rebind retains original expiry, CAS and immutable history, invalidates old claims without replay',t=>{
 const s=setup(t);s.call('activate',s.activate);const original=s.call('list').members.find(x=>x.agent==='lucy'),taskId=id(),messageId=id();
 s.call('send',{id:messageId,body:'Original member'},s.actor('lucy'));s.call('task_create',{id:taskId,title:'One active run',body:'Inspect',assignee:'lucy'});const claim={task_id:taskId,run_id:id(),claim_id:id()};s.call('claim',claim,s.actor('lucy'));
 const candidate={agent:'lucy',connection_id:'new-verified-lucy'},owner={...s.owner,verifiedConnections:[...s.owner.verifiedConnections,candidate]};
 const args={id:id(),agent:'lucy',current_membership_id:original.id,connection_id:candidate.connection_id,confirm:true};
 rejected(()=>s.call('rebind',args,s.actor('lucy')),403);rejected(()=>s.call('rebind',{...args,confirm:false},owner),400);rejected(()=>s.call('rebind',{...args,current_membership_id:id()},owner),409);rejected(()=>s.call('rebind',{...args,agent:'mast'},owner),409);rejected(()=>s.call('rebind',{...args,connection_id:'unverified'},owner),403);
 const result=s.call('rebind',args,owner,s.now+1000);assert.notEqual(result.membership.id,original.id);assert.equal(result.membership.operationId,args.id);assert.equal(result.membership.expiresAt,original.expiresAt);assert.equal(s.call('rebind',args,owner,s.now+2000).newWrite,false);
 const history=s.db.prepare('SELECT * FROM board_membership_history').all();assert.equal(history.length,1);assert.equal(history[0].id,original.id);assert.equal(JSON.parse(history[0].membership_json).connection_id,original.connectionId);
 rejected(()=>s.call('list',{},s.actor('lucy'),s.now+2000),403);const next={...s.actor('lucy'),connectionId:candidate.connection_id};assert.equal(s.call('list',{},next,s.now+2000).messages.length,1);
 assert.equal(s.call('tasks',{},owner,s.now+2000).tasks[0].state,'unknown');
 rejected(()=>s.call('finish',{id:id(),...claim,fence:1,outcome:'completed',summary:'Old claim'},next,s.now+2000),409);
 rejected(()=>s.call('claim',{task_id:taskId,run_id:id(),claim_id:id()},next,s.now+2000),409);
 rejected(()=>s.call('send',{id:messageId,body:'Original member'},next,s.now+2000),409);
 rejected(()=>s.call('rebind',{...args,id:id()},owner,s.now+2000),409);
 s.call('resolve',{id:id(),task_id:taskId,expected_fence:1,resolution:'retry',evidence:'Owner confirmed old run stopped'},owner,s.now+2000);
 assert.equal(s.call('claim',{task_id:taskId,run_id:id(),claim_id:id()},next,s.now+2000).task.fence,3);
});
test('explicit rebind can replace revoked membership but never revive an expired grant',t=>{
 const s=setup(t);s.call('activate',s.activate);const original=s.call('list').members.find(x=>x.agent==='mast');s.call('revoke',{membership_id:original.id,confirm:true});
 const args={id:id(),agent:'mast',current_membership_id:original.id,connection_id:original.connectionId,confirm:true};
 const r=s.call('rebind',args,s.owner,s.now+1000);assert.equal(r.membership.revokedAt,null);assert.equal(r.membership.expiresAt,original.expiresAt);assert.equal(s.call('list',{},s.actor('mast'),s.now+2000).identity,'mast');
 s.call('revoke',{membership_id:r.membership.id,confirm:true});
 rejected(()=>s.call('rebind',{...args,id:id(),current_membership_id:r.membership.id},s.owner,Date.parse(original.expiresAt)),403);
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM board_membership_history').get().n,1);
});
