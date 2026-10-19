// Prospective shared board only. No imports of private conversation/task tables.
// Caller-supplied text is data; authority always comes from authenticated ingress.
import {RelayError, uuid, canonical, json, RELAY_OWNER} from './relay-common.js';
export const BOARD_ID='jarvis';
export const BOARD_DAYS=365;
export const BOARD_LEASE_MS=900000;
const rows=(ctx,q,...args)=>[...ctx.storage.sql.exec(q,...args)];
const fail=(status,message)=>{throw new RelayError(-32602,message,{status});};
const iso=n=>n===null?null:new Date(n).toISOString();
const agents=['lucy','mast','makima'];
export function boardFields(v,allowed,required=[]){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k))||required.some(k=>!(k in v)))fail(400,'Invalid board arguments');}
export function boardSchema(ctx){
 ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS board_activation (id TEXT PRIMARY KEY,board TEXT NOT NULL UNIQUE,created_ms INTEGER NOT NULL,owner_device TEXT NOT NULL,fingerprint TEXT NOT NULL)');
 ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS board_memberships (id TEXT PRIMARY KEY,board TEXT NOT NULL,agent TEXT NOT NULL,connection_id TEXT NOT NULL,operation_id TEXT NOT NULL,created_ms INTEGER NOT NULL,expires_ms INTEGER NOT NULL,revoked_ms INTEGER,UNIQUE(board,agent))');
 ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS board_membership_history (id TEXT PRIMARY KEY,board TEXT NOT NULL,agent TEXT NOT NULL,membership_json TEXT NOT NULL,replaced_ms INTEGER NOT NULL,replacement_id TEXT NOT NULL,owner_actor TEXT NOT NULL,operation_id TEXT NOT NULL)');
 ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS board_messages (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,board TEXT NOT NULL,identity TEXT NOT NULL,actor TEXT NOT NULL,auth_source TEXT NOT NULL,body TEXT NOT NULL,reply_to TEXT,kind TEXT NOT NULL,result_links TEXT NOT NULL,request_json TEXT,approval_json TEXT,created_ms INTEGER NOT NULL)');
 ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS board_messages_page ON board_messages(board,seq)');
 ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS board_tasks (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,board TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,assignee TEXT NOT NULL,creator TEXT NOT NULL,actor TEXT NOT NULL,created_ms INTEGER NOT NULL,state TEXT NOT NULL,fence INTEGER NOT NULL DEFAULT 0,run_id TEXT,claim_id TEXT,claim_actor TEXT,lease_until INTEGER,result TEXT)');
 ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS board_operations (id TEXT PRIMARY KEY,board TEXT NOT NULL,actor TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL)');
}
const member=r=>({id:r.id,agent:r.agent,connectionId:r.connection_id,operationId:r.operation_id,createdAt:iso(r.created_ms),expiresAt:iso(r.expires_ms),revokedAt:iso(r.revoked_ms)});
const message=r=>({id:r.id,sequence:r.seq,identity:r.identity,body:r.body,replyTo:r.reply_to,createdAt:iso(r.created_ms),kind:r.kind,resultLinks:JSON.parse(r.result_links),authority:r.identity==='owner'?'owner':'board-agent',authorAuthenticated:true,principal:r.identity==='owner'?RELAY_OWNER:'agent:'+r.identity,authenticationSource:r.auth_source,contentTrust:r.identity==='owner'?'authenticated-owner-intent':'untrusted-data',quotedContentTrust:'untrusted-data',boardId:r.board,approvalRequest:r.request_json?JSON.parse(r.request_json):null,approval:r.approval_json?JSON.parse(r.approval_json):null});
const task=r=>({id:r.id,sequence:r.seq,title:r.title,body:r.body,assignee:r.assignee,creator:r.creator,createdAt:iso(r.created_ms),state:r.state,fence:r.fence,runId:r.run_id,claimId:r.claim_id,leaseUntil:iso(r.lease_until),result:r.result?JSON.parse(r.result):null,completionEvidence:r.state==='completed'?(r.result&&JSON.parse(r.result).reportedBy?'agent-report':'owner-reconciliation'):null,independentlyVerified:false});
function page(after){if(after===undefined)return 0;if(typeof after!=='string'||! /^(0|[1-9][0-9]{0,14})$/.test(after))fail(400,'Invalid board cursor');return Number(after);}
function text(v,max=6000){if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,'Invalid board text');return v;}
function links(v=[]){if(!Array.isArray(v)||v.length>10||v.some(s=>{try{const u=new URL(s);return typeof s!=='string'||s.length>2048||u.protocol!=='https:'||!!u.username||!!u.password;}catch{return true;}}))fail(400,'Invalid result links');return v;}
function auth(ctx,identity,now){
 if(!identity||!['owner',...agents].includes(identity.agent)||typeof identity.actor!=='string'||!identity.actor)fail(401,'Board authentication required');
 if(identity.agent==='owner'){if(!['owner-device-session','owner-password-session'].includes(identity.authenticationSource))fail(401,'Verified owner session provenance required');return identity;}
 const row=rows(ctx,'SELECT * FROM board_memberships WHERE board=? AND agent=?',BOARD_ID,identity.agent)[0];
 if(!row||row.connection_id!==identity.connectionId||row.revoked_ms!==null||row.expires_ms<=now)fail(403,'Explicit live board membership required');
 return {...identity,actor:'membership:'+row.id};
}
const requireOwner=a=>{if(a.agent!=='owner')fail(403,'Owner session required');};
function target(ctx,id){if(!uuid(id))fail(400,'Invalid task ID');const r=rows(ctx,'SELECT * FROM board_tasks WHERE id=? AND board=?',id,BOARD_ID)[0];if(!r)fail(404,'Board task not found');return r;}
// All authentication callbacks execute INSIDE the same synchronous transaction as
// mutation. Remote-token validation, where needed, must precede this function;
// central board membership is always rechecked here without an await boundary.
export function boardStore(ctx,input,authorize,now=Date.now()){
 boardSchema(ctx);
 // Persist lease uncertainty even when a subsequent stale claim is rejected.
 ctx.storage.transactionSync(()=>{auth(ctx,authorize(),now);ctx.storage.sql.exec("UPDATE board_tasks SET state='unknown',lease_until=NULL WHERE board=? AND state='claimed' AND lease_until<=?",BOARD_ID,now);});
 return ctx.storage.transactionSync(()=>{
  const a=auth(ctx,authorize(),now),args=input.args||{},op=input.op;
  if(op==='activate'){
   requireOwner(a);boardFields(args,['id','confirm','duration_days','members'],['id','confirm','duration_days','members']);
   if(!uuid(args.id)||args.confirm!==true||args.duration_days!==BOARD_DAYS||!Array.isArray(args.members)||args.members.length!==3)fail(400,'Explicit 365-day board confirmation required');
   const seen=new Set();for(const m of args.members){boardFields(m,['agent','connection_id'],['agent','connection_id']);if(!agents.includes(m.agent)||seen.has(m.agent)||typeof m.connection_id!=='string'||!m.connection_id||m.connection_id.length>256)fail(400,'Invalid board membership');seen.add(m.agent);}
   const fingerprint=canonical({...args,members:[...args.members].sort((x,y)=>x.agent.localeCompare(y.agent))});
   const old=rows(ctx,'SELECT * FROM board_activation WHERE board=? OR id=?',BOARD_ID,args.id)[0];
   if(old){if(old.id!==args.id||old.fingerprint!==fingerprint)fail(409,'Board activation conflict');return {boardId:BOARD_ID,active:true,newWrite:false};}
   // Candidate verification is supplied by owner ingress, not by request data.
   if(!a.verifiedConnections||args.members.some(m=>!a.verifiedConnections.some(c=>c.agent===m.agent&&c.connection_id===m.connection_id)))fail(403,'Verified board connections required');
   ctx.storage.sql.exec('INSERT INTO board_activation VALUES(?,?,?,?,?)',args.id,BOARD_ID,now,a.actor,fingerprint);
   for(const m of args.members)ctx.storage.sql.exec('INSERT INTO board_memberships VALUES(?,?,?,?,?,?,?,NULL)',crypto.randomUUID(),BOARD_ID,m.agent,m.connection_id,args.id,now,now+BOARD_DAYS*86400000);
   return {boardId:BOARD_ID,active:true,newWrite:true};
  }
  if(op==='rebind'){
   requireOwner(a);boardFields(args,['id','agent','current_membership_id','connection_id','confirm'],['id','agent','current_membership_id','connection_id','confirm']);
   if(!uuid(args.id)||!uuid(args.current_membership_id)||!agents.includes(args.agent)||typeof args.connection_id!=='string'||!args.connection_id||args.connection_id.length>256||args.confirm!==true)fail(400,'Explicit same-agent rebind confirmation required');
   const fingerprint=canonical({op,args}),prior=rows(ctx,'SELECT * FROM board_operations WHERE id=?',args.id)[0];
   if(prior){if(prior.board!==BOARD_ID||prior.actor!==a.actor||prior.fingerprint!==fingerprint)fail(409,'Board operation ID conflict');return {...JSON.parse(prior.result),newWrite:false};}
   const current=rows(ctx,'SELECT * FROM board_memberships WHERE board=? AND agent=?',BOARD_ID,args.agent)[0];
   if(!current||current.id!==args.current_membership_id)fail(409,'Stale board membership');
   if(current.expires_ms<=now)fail(403,'Original board membership expired; rebind cannot extend access');
   if(!a.verifiedConnections?.some(c=>c.agent===args.agent&&c.connection_id===args.connection_id))fail(403,'Verified same-agent connection required');
   if(current.connection_id===args.connection_id&&current.revoked_ms===null)fail(409,'Connection already bound');
   if(rows(ctx,'SELECT COUNT(*) AS n FROM board_membership_history')[0].n>=128||rows(ctx,'SELECT COUNT(*) AS n FROM board_operations')[0].n>=20000)fail(429,'Board rebind capacity');
   const next={...current,id:crypto.randomUUID(),connection_id:args.connection_id,operation_id:args.id,created_ms:now,revoked_ms:null};
   const historical={...current,revoked_ms:current.revoked_ms??now};
   ctx.storage.sql.exec('INSERT INTO board_membership_history VALUES(?,?,?,?,?,?,?,?)',current.id,BOARD_ID,current.agent,JSON.stringify(historical),now,next.id,a.actor,args.id);
   ctx.storage.sql.exec('UPDATE board_memberships SET id=?,connection_id=?,operation_id=?,created_ms=?,revoked_ms=NULL WHERE id=? AND board=? AND agent=?',next.id,next.connection_id,next.operation_id,now,current.id,BOARD_ID,current.agent);
   // Replaced identities cannot renew/report old claims, and the new membership
   // cannot inherit them. Owner reconciliation is required before any retry.
   ctx.storage.sql.exec("UPDATE board_tasks SET state='unknown',lease_until=NULL WHERE board=? AND state='claimed' AND claim_actor=?",BOARD_ID,'membership:'+current.id);
   const result={boardId:BOARD_ID,membership:member(next),newWrite:true};
   ctx.storage.sql.exec('INSERT INTO board_operations VALUES(?,?,?,?,?)',args.id,BOARD_ID,a.actor,fingerprint,JSON.stringify(result));return result;
  }
  if(op==='revoke'){
   requireOwner(a);boardFields(args,['membership_id','confirm'],['membership_id','confirm']);if(!uuid(args.membership_id)||args.confirm!==true)fail(400,'Explicit membership revocation required');
   if(!rows(ctx,'SELECT id FROM board_memberships WHERE id=? AND board=?',args.membership_id,BOARD_ID).length)fail(404,'Board membership not found');
   ctx.storage.sql.exec('UPDATE board_memberships SET revoked_ms=COALESCE(revoked_ms,?) WHERE id=? AND board=?',now,args.membership_id,BOARD_ID);return {revoked:true,membershipId:args.membership_id};
  }
  const active=!!rows(ctx,'SELECT id FROM board_activation WHERE board=?',BOARD_ID).length;
  if(op==='list'){
   boardFields(args,['after']);const selected=active?rows(ctx,'SELECT * FROM board_messages WHERE board=? AND seq>? ORDER BY seq LIMIT 51',BOARD_ID,page(args.after)):[];
   return {boardId:BOARD_ID,active,identity:a.agent,members:rows(ctx,'SELECT * FROM board_memberships WHERE board=? ORDER BY agent',BOARD_ID).map(member),messages:selected.slice(0,50).map(message),nextCursor:selected.length>50?String(selected[49].seq):null};
  }
  if(!active)fail(409,'Board awaits explicit activation');
  if(op==='message'){
   boardFields(args,['message_id'],['message_id']);if(!uuid(args.message_id))fail(400,'Invalid message ID');const row=rows(ctx,'SELECT * FROM board_messages WHERE id=? AND board=?',args.message_id,BOARD_ID)[0];if(!row)fail(404,'Board message not found');return {entry:message(row)};
  }
  if(op==='send'||op==='approve'){
   let body,reply,request=null,approval=null,resultLinks=[],kind='message';
   if(op==='approve'){
    requireOwner(a);boardFields(args,['id','request_id','decision'],['id','request_id','decision']);
    if(!uuid(args.request_id)||!['approve','decline'].includes(args.decision))fail(400,'Invalid board approval');
    const target=rows(ctx,'SELECT * FROM board_messages WHERE board=? AND id=?',BOARD_ID,args.request_id)[0];
    if(!target?.request_json)fail(404,'Approval request not found');
    const q=JSON.parse(target.request_json);approval={requestId:target.id,action:q.action,question:q.question,target:q.target,version:q.version,decision:args.decision,effect:'record-only',requestExpiresAt:q.expiresAt};
    body=args.decision==='approve'?'Approved':'Declined';reply=target.id;kind='approval';
   }else{
    boardFields(args,['id','body','reply_to','result_links','approval_request'],['id','body']);body=text(args.body);resultLinks=links(args.result_links);reply=args.reply_to??null;
    if(args.approval_request!==undefined){const q=args.approval_request;boardFields(q,['action','question','target','version','expires_at'],['action','question','target','version','expires_at']);text(q.action,2000);text(q.question,2000);text(q.target,2000);text(q.version,256);const expiry=Date.parse(q.expires_at);if(typeof q.expires_at!=='string'||!Number.isSafeInteger(expiry)||iso(expiry)!==q.expires_at)fail(400,'Invalid approval request expiry');request={id:args.id,action:q.action,question:q.question,target:q.target,version:q.version,expiresAt:q.expires_at};}
   }
   if(!uuid(args.id))fail(400,'Invalid message ID');
   if(reply!==null&&(!uuid(reply)||reply===args.id||!rows(ctx,'SELECT id FROM board_messages WHERE board=? AND id=?',BOARD_ID,reply).length))fail(404,'Board reply target not found');
   const old=rows(ctx,'SELECT * FROM board_messages WHERE id=?',args.id)[0],requestJSON=request?JSON.stringify(request):null,approvalJSON=approval?JSON.stringify(approval):null;
   if(old){if(old.board!==BOARD_ID||old.actor!==a.actor||old.identity!==a.agent||old.body!==body||old.reply_to!==reply||old.kind!==kind||old.result_links!==JSON.stringify(resultLinks)||old.request_json!==requestJSON||old.approval_json!==approvalJSON)fail(409,'Board message ID conflict');return {entry:message(old),newWrite:false};}
   if(request&&(Date.parse(request.expiresAt)<=now||Date.parse(request.expiresAt)>now+30*86400000))fail(400,'Approval request must expire within 30 days');
   if(approval){if(Date.parse(approval.requestExpiresAt)<=now)fail(409,'Approval request expired');if(rows(ctx,"SELECT id FROM board_messages WHERE board=? AND kind='approval' AND reply_to=?",BOARD_ID,reply).length)fail(409,'Approval request already decided');}
   if(rows(ctx,'SELECT COUNT(*) AS n FROM board_messages')[0].n>=20000)fail(429,'Board message capacity');
   ctx.storage.sql.exec('INSERT INTO board_messages(id,board,identity,actor,auth_source,body,reply_to,kind,result_links,request_json,approval_json,created_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',args.id,BOARD_ID,a.agent,a.actor,a.agent==='owner'?a.authenticationSource:({lucy:'lucy-oauth-mcp',mast:'mast-muse-profile',makima:'makima-oauth-mcp'})[a.agent],body,reply,kind,JSON.stringify(resultLinks),requestJSON,approvalJSON,now);
   return {entry:message(rows(ctx,'SELECT * FROM board_messages WHERE id=?',args.id)[0]),newWrite:true};
  }
  if(op==='tasks'){
   boardFields(args,['after']);const result=rows(ctx,'SELECT * FROM board_tasks WHERE board=? AND seq>? ORDER BY seq LIMIT 51',BOARD_ID,page(args.after));return {tasks:result.slice(0,50).map(r=>task(expire(ctx,r,now))),nextCursor:result.length>50?String(result[49].seq):null};
  }
  if(op==='task_create'){
   boardFields(args,['id','title','body','assignee'],['id','title','body','assignee']);if(!uuid(args.id)||!agents.includes(args.assignee))fail(400,'Invalid shared task');text(args.title,160);text(args.body);
   const old=rows(ctx,'SELECT * FROM board_tasks WHERE id=?',args.id)[0];if(old){if(old.board!==BOARD_ID||old.actor!==a.actor||old.title!==args.title||old.body!==args.body||old.assignee!==args.assignee)fail(409,'Board task ID conflict');return {task:task(expire(ctx,old,now)),newWrite:false};}
   if(rows(ctx,'SELECT COUNT(*) AS n FROM board_tasks')[0].n>=2000)fail(429,'Board task capacity');
   ctx.storage.sql.exec("INSERT INTO board_tasks(id,board,title,body,assignee,creator,actor,created_ms,state) VALUES(?,?,?,?,?,?,?,?, 'pending')",args.id,BOARD_ID,args.title,args.body,args.assignee,a.agent,a.actor,now);return {task:task(target(ctx,args.id)),newWrite:true};
  }
  if(op==='claim'){
   boardFields(args,['task_id','run_id','claim_id'],['task_id','run_id','claim_id']);if(a.agent==='owner'||!uuid(args.run_id)||!uuid(args.claim_id))fail(400,'Agent claim required');let r=expire(ctx,target(ctx,args.task_id),now);if(r.assignee!==a.agent)fail(403,'Task assignee required');
   if(r.state==='claimed'&&r.run_id===args.run_id&&r.claim_id===args.claim_id&&r.claim_actor===a.actor)return {task:task(r),newWrite:false};
   if(r.state!=='pending')fail(409,r.state==='unknown'?'Task outcome unknown; owner reconciliation required':'Task unavailable');
   // Durable serialized claim and monotonic fencing. Expired leases are UNKNOWN,
   // never automatically returned to pending or handed to a second executor.
   ctx.storage.sql.exec("UPDATE board_tasks SET state='claimed',fence=fence+1,run_id=?,claim_id=?,claim_actor=?,lease_until=? WHERE id=? AND state='pending'",args.run_id,args.claim_id,a.actor,now+BOARD_LEASE_MS,r.id);return {task:task(target(ctx,r.id)),newWrite:true};
  }
  if(['renew','finish','resolve'].includes(op)){
   const allowed=op==='resolve'?['id','task_id','expected_fence','resolution','evidence']:op==='finish'?['id','task_id','run_id','claim_id','fence','outcome','summary','result_links']:['id','task_id','run_id','claim_id','fence'];
   boardFields(args,allowed,allowed.filter(k=>k!=='result_links'));if(!uuid(args.id))fail(400,'Operation ID required');
   const fingerprint=canonical({op,args}),prior=rows(ctx,'SELECT * FROM board_operations WHERE id=?',args.id)[0];if(prior){if(prior.board!==BOARD_ID||prior.actor!==a.actor||prior.fingerprint!==fingerprint)fail(409,'Board operation ID conflict');return {...JSON.parse(prior.result),newWrite:false};}
   if(rows(ctx,'SELECT COUNT(*) AS n FROM board_operations')[0].n>=20000)fail(429,'Board operation capacity');
   let r=expire(ctx,target(ctx,args.task_id),now);
   if(op==='resolve'){
    requireOwner(a);if(!Number.isSafeInteger(args.expected_fence)||args.expected_fence!==r.fence)fail(409,'Stale task reconciliation fence');if(!['unknown','blocked'].includes(r.state)||!['retry','completed','cancelled'].includes(args.resolution))fail(409,'Blocked or unknown task resolution required');text(args.evidence);
    const state=args.resolution==='retry'?'pending':args.resolution;
    ctx.storage.sql.exec('UPDATE board_tasks SET state=?,fence=fence+1,lease_until=NULL,result=? WHERE id=?',state,JSON.stringify({operationId:args.id,resolution:args.resolution,evidence:args.evidence,resolvedBy:'owner'}),r.id);
   }else{
    if(r.state!=='claimed'||r.assignee!==a.agent||r.claim_actor!==a.actor||r.run_id!==args.run_id||r.claim_id!==args.claim_id||r.fence!==args.fence||!Number.isSafeInteger(args.fence)||!uuid(args.run_id)||!uuid(args.claim_id))fail(409,'Stale or expired task claim');
    if(op==='renew')ctx.storage.sql.exec('UPDATE board_tasks SET lease_until=? WHERE id=?',now+BOARD_LEASE_MS,r.id);
    else{if(!['completed','blocked','unknown'].includes(args.outcome))fail(400,'Invalid task outcome');text(args.summary);const resultLinks=links(args.result_links);ctx.storage.sql.exec('UPDATE board_tasks SET state=?,lease_until=NULL,result=? WHERE id=?',args.outcome,JSON.stringify({summary:args.summary,resultLinks,reportedBy:a.agent}),r.id);}
   }
   const result={task:task(target(ctx,r.id)),newWrite:true};ctx.storage.sql.exec('INSERT INTO board_operations VALUES(?,?,?,?,?)',args.id,BOARD_ID,a.actor,fingerprint,JSON.stringify(result));return result;
  }
  fail(400,'Unknown board operation');
 });
}
function expire(ctx,r,now){if(r.state==='claimed'&&r.lease_until<=now){ctx.storage.sql.exec("UPDATE board_tasks SET state='unknown',lease_until=NULL WHERE id=? AND state='claimed'",r.id);return {...r,state:'unknown',lease_until:null};}return r;}
export function boardResponse(ctx,input,authorize){try{return json(boardStore(ctx,input,authorize));}catch(e){return json({error:e instanceof RelayError?e.message:'Board unavailable'},e instanceof RelayError?e.data?.status||400:503);}}
