const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const identities=['owner','lucy','mast','makima'];
const check=(condition)=>{if(!condition)throw Error('Invalid shared board response.');};
export function boardMessage(m){
 check(m&&m.boardId==='jarvis'&&m.authorAuthenticated===true&&m.contentTrust===(m.identity==='owner'?'authenticated-owner-intent':'untrusted-data')&&m.quotedContentTrust==='untrusted-data'&&uuid(m.id)&&Number.isSafeInteger(m.sequence)&&m.sequence>0&&identities.includes(m.identity)&&typeof m.body==='string'&&m.body.length<=6000&&date(m.createdAt)&&(m.replyTo===null||uuid(m.replyTo))&&['message','approval'].includes(m.kind)&&m.authority===(m.identity==='owner'?'owner':'board-agent')&&Array.isArray(m.resultLinks)&&m.resultLinks.length<=10);
 const sources={owner:['owner-device-session','owner-password-session'],lucy:['lucy-oauth-mcp'],mast:['mast-muse-profile'],makima:['makima-oauth-mcp']};
 check(sources[m.identity].includes(m.authenticationSource)&&m.principal===(m.identity==='owner'?'github:183016859':'agent:'+m.identity));
 const resultLinks=m.resultLinks.map(link=>{const url=new URL(link);check(url.protocol==='https:'&&!url.username&&!url.password);return url.href;});
 const approvalRequest=m.approvalRequest??null,approval=m.approval??null;
 if(approvalRequest)check(approvalRequest.id===m.id&&typeof approvalRequest.target==='string'&&typeof approvalRequest.version==='string'&&typeof approvalRequest.action==='string'&&approvalRequest.action.length<=2000&&typeof approvalRequest.question==='string'&&approvalRequest.question.length<=2000&&date(approvalRequest.expiresAt)&&m.kind==='message');
 if(m.kind==='approval')check(m.identity==='owner'&&approval&&approval.effect==='record-only'&&uuid(approval.requestId)&&m.replyTo===approval.requestId&&typeof approval.target==='string'&&typeof approval.version==='string'&&typeof approval.action==='string'&&typeof approval.question==='string'&&['approve','decline'].includes(approval.decision)&&date(approval.requestExpiresAt)&&m.body===(approval.decision==='approve'?'Approved':'Declined'));else check(approval===null);
 return {principal:m.principal,authenticationSource:m.authenticationSource,approvalRequest,approval,id:m.id,sequence:m.sequence,identity:m.identity,body:m.body,replyTo:m.replyTo,createdAt:m.createdAt,kind:m.kind,authority:m.authority,resultLinks};
}
export function createBoardApi(call){
 const root='/relay/owner/board';
 return {
  async connections(){const data=await call(root+'/connections');check(Array.isArray(data.connections));check(data.connections.every(c=>identities.slice(1).includes(c.agent)&&c.connection_type===({lucy:'lucy-oauth-grant',mast:'mast-muse-profile',makima:'makima-oauth-grant'}[c.agent])&&typeof c.connection_id==='string'&&c.connection_id.length>0&&c.connection_id.length<=256));return data.connections;},
  async activate(payload){check(uuid(payload.id)&&payload.confirm===true&&payload.duration_days===365&&payload.members.length===3);const data=await call(root+'/activate',{body:payload});check(data.boardId==='jarvis'&&data.active===true);return data;},
  async read(after='0'){
   check(/^\d{1,15}$/.test(String(after)));
   const data=await call(root+'?after='+encodeURIComponent(after));
   check(data.boardId==='jarvis'&&typeof data.active==='boolean'&&data.identity==='owner'&&Array.isArray(data.members)&&Array.isArray(data.messages)&&data.messages.length<=50);
   const members=data.members.map(m=>{check(uuid(m.id)&&uuid(m.operationId)&&identities.slice(1).includes(m.agent)&&typeof m.connectionId==='string'&&m.connectionId.length<=256&&date(m.expiresAt)&&(m.revokedAt===null||date(m.revokedAt)));return {id:m.id,operationId:m.operationId,agent:m.agent,connectionId:m.connectionId,expiresAt:m.expiresAt,revokedAt:m.revokedAt};});
   check(members.length<=3&&new Set(members.map(m=>m.agent)).size===members.length);
   const messages=data.messages.map(boardMessage);
   check(messages.every((m,i)=>m.sequence>Number(after)&&(!i||m.sequence>messages[i-1].sequence))&&new Set(messages.map(m=>m.id)).size===messages.length);
   check(data.nextCursor===null||messages.length&&String(messages.at(-1).sequence)===data.nextCursor);
   return {active:data.active,identity:data.identity,members,messages,nextCursor:data.nextCursor};
  },
  async send(payload){check(uuid(payload.id)&&typeof payload.body==='string'&&payload.body.trim()&&payload.body.length<=6000);const data=await call(root+'/messages',{body:payload});const entry=boardMessage(data.entry);check(entry.id===payload.id&&entry.body===payload.body&&entry.identity==='owner'&&entry.kind==='message'&&entry.approval===null&&entry.approvalRequest===null&&entry.resultLinks.length===0&&entry.replyTo===(payload.reply_to??null));return entry;},
  async lookup(id){check(uuid(id));let data;try{data=await call(root+'/message?message_id='+encodeURIComponent(id));}catch(error){if(error.kind==='board_message_missing')return null;throw error;}const entry=boardMessage(data.entry);check(entry.id===id);return entry;},
  async approve(payload,request){check(uuid(payload.id)&&payload.request_id===request.id&&['approve','decline'].includes(payload.decision));const data=await call(root+'/approvals',{body:payload}),entry=boardMessage(data.entry);check(entry.id===payload.id&&entry.approval?.requestId===request.id&&entry.approval.target===request.target&&entry.approval.version===request.version&&entry.approval.action===request.action&&entry.approval.question===request.question&&entry.approval.requestExpiresAt===request.expiresAt&&entry.approval.decision===payload.decision);return entry;},
  async tasks(after='0'){check(/^\d{1,15}$/.test(String(after)));const data=await call(root+'/tasks?after='+encodeURIComponent(after));check(Array.isArray(data.tasks)&&data.tasks.length<=50);const tasks=data.tasks.map(boardTask);check(tasks.every((t,i)=>t.sequence>Number(after)&&(!i||t.sequence>tasks[i-1].sequence)));check(data.nextCursor===null||tasks.length&&String(tasks.at(-1).sequence)===data.nextCursor);return {tasks,nextCursor:data.nextCursor};},
  async createTask(payload){const data=await call(root+'/tasks',{body:payload}),task=boardTask(data.task);check(task.id===payload.id&&task.title===payload.title&&task.body===payload.body&&task.assignee===payload.assignee&&task.creator==='owner');return task;},
  async resolveTask(payload){const data=await call(root+'/tasks/resolve',{body:payload}),task=boardTask(data.task);check(task.id===payload.task_id&&task.result?.operationId===payload.id&&task.result.resolvedBy==='owner'&&task.result.resolution===payload.resolution&&task.result.evidence===payload.evidence);return task;},
  async findTask(id){let cursor='0';do{const data=await this.tasks(cursor),found=data.tasks.find(t=>t.id===id);if(found)return found;cursor=data.nextCursor;}while(cursor!==null);return null;},
  async rebind(payload,original){const data=await call(root+'/rebind',{body:payload}),m=data.membership;check(data.boardId==='jarvis'&&typeof data.newWrite==='boolean'&&m&&uuid(m.id)&&m.id!==original.id&&m.operationId===payload.id&&m.agent===payload.agent&&m.connectionId===payload.connection_id&&m.expiresAt===original.expiresAt&&m.revokedAt===null);return {id:m.id,operationId:m.operationId,agent:m.agent,connectionId:m.connectionId,expiresAt:m.expiresAt,revokedAt:m.revokedAt};},
  async revoke(id){check(uuid(id));return call(root+'/revoke',{body:{membership_id:id,confirm:true}});}
 };
}

export function boardTask(t){check(t&&t.independentlyVerified===false&&(t.state==='completed'?['agent-report','owner-reconciliation'].includes(t.completionEvidence):t.completionEvidence===null)&&uuid(t.id)&&Number.isSafeInteger(t.sequence)&&t.sequence>0&&typeof t.title==='string'&&t.title.length<=160&&typeof t.body==='string'&&t.body.length<=6000&&identities.slice(1).includes(t.assignee)&&identities.includes(t.creator)&&date(t.createdAt)&&['pending','claimed','unknown','completed','blocked','cancelled'].includes(t.state)&&Number.isSafeInteger(t.fence)&&t.fence>=0&&(t.leaseUntil===null||date(t.leaseUntil)));
 if(t.result){if(t.result.resolvedBy==='owner'){check(uuid(t.result.operationId)&&['retry','completed','cancelled'].includes(t.result.resolution)&&typeof t.result.evidence==='string');}else{check(t.result.reportedBy===t.assignee&&typeof t.result.summary==='string'&&Array.isArray(t.result.resultLinks));t.result.resultLinks.forEach(link=>{const u=new URL(link);check(u.protocol==='https:'&&!u.username&&!u.password);});}}
 return {completionEvidence:t.completionEvidence,independentlyVerified:false,id:t.id,sequence:t.sequence,title:t.title,body:t.body,assignee:t.assignee,creator:t.creator,createdAt:t.createdAt,state:t.state,fence:t.fence,leaseUntil:t.leaseUntil,result:t.result};}
