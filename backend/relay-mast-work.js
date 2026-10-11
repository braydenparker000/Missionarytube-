// The owner/Mast transport authenticates before entering this synchronous store.
// Reuse Relay's validation/policy constants, never its owner-OAuth data or grants.
import {mastFileMetadata} from './relay-mast-attachments.js';
import {RelayError,uuid,cursor,canonical,fields} from './relay-common.js';
import {relayOwnerJobSpecification,relayOwnerJobValidateRpc,RELAY_OWNER_JOB_LEASE_MS,RELAY_OWNER_JOB_MAX_ATTEMPTS} from './relay-owner-jobs.js';
const rows=(ctx,q,...v)=>[...ctx.storage.sql.exec(q,...v)];
const fail=(status,message)=>{throw new RelayError(-32602,message,{status});};
function schema(ctx){
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS relay_mast_work (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,value TEXT NOT NULL)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS relay_mast_work_events (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,job_id TEXT NOT NULL,writer TEXT NOT NULL,arguments TEXT NOT NULL,created_ms INTEGER NOT NULL)');
  ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS relay_mast_work_event_job ON relay_mast_work_events(job_id,seq)');
}
function read(ctx,id){if(!uuid(id))fail(400,'Invalid Muse request ID');const r=rows(ctx,'SELECT value FROM relay_mast_work WHERE id=?',id)[0];if(!r)fail(404,'Muse request not found');return JSON.parse(r.value);}
const write=(ctx,j)=>rows(ctx,'UPDATE relay_mast_work SET value=? WHERE id=?',JSON.stringify(j),j.id);
function reply(ctx,j){return rows(ctx,"SELECT id,body,created_at FROM relay_mast_entries WHERE reply_to=? AND role='mast'",j.id)[0];}
function results(ctx,j){const r=reply(ctx,j);return r?[{id:r.id,replyId:r.id,version:1,body:r.body,createdAt:r.created_at,correctionSummary:null},...j.corrections]:[];}
function stage(ctx,j,now){if(['completed','failed','cancelled','waiting_for_owner'].includes(j.stage))return j.stage;if(reply(ctx,j)||j.run&&j.expires<=now)return 'outcome_unknown';return j.stage;}
function view(ctx,j,now){const resultHistory=results(ctx,j),effective=stage(ctx,j,now);
  const noStart=['failed','cancelled'].includes(j.stage)&&j.outcome==='not_started';
  return {...j,device:undefined,writer:undefined,stage:effective,execution:j.run?{runId:j.run,leaseExpiresAt:new Date(j.expires).toISOString()}:null,
    resultHistory,latestResult:resultHistory.at(-1)||null,
    retryAllowed:!mastFileMetadata(ctx,j.id).length&&!j.retryId&&j.attempt<RELAY_OWNER_JOB_MAX_ATTEMPTS&&['failed','cancelled','outcome_unknown'].includes(effective)&&(!j.run||j.expires<=now||['failed','cancelled'].includes(j.stage))&&(!['unclassified','consequential'].includes(j.actionKind)||noStart),
    retryRequiresConfirmation:['unclassified','consequential'].includes(j.actionKind)||j.outcome==='unknown'||effective==='outcome_unknown',
    visibility:'private',destination:'mast',authenticationSource:'mast-bearer-report',completion:j.completion||null};
}
function receipt(ctx,j,input,writer,now){
  const previous=rows(ctx,'SELECT * FROM relay_mast_work_events WHERE id=?',input.event_id)[0],args=canonical(input);
  if(previous){if(previous.job_id!==j.id||previous.writer!==writer||previous.arguments!==args)fail(409,'Muse event ID conflict');return true;}
  if(rows(ctx,'SELECT COUNT(*) AS n FROM relay_mast_work_events WHERE job_id=?',j.id)[0].n>=100)fail(429,'Muse request event limit reached');
  rows(ctx,'INSERT INTO relay_mast_work_events(id,job_id,writer,arguments,created_ms) VALUES(?,?,?,?,?)',input.event_id,j.id,writer,args,now);return false;
}
function lease(j,writer,run,now,expired=false){if(!j.run||j.writer!==writer||j.run!==run||!expired&&j.expires<=now)fail(409,'Matching live Muse run required');}
export function mastWork(ctx,input,{owner,writer,send,now=Date.now()}={}){
  schema(ctx);const op=input.op;
  const allowed={work_list:['after'],work_read:['job_id'],work_create:['id','body','title','action_kind','project_title','goal_title'],work_cancel:['job_id','event_id'],work_retry:['job_id','id','confirm_duplicate_risk'],work_claim:['job_id','event_id','run_id'],work_update:['job_id','event_id','run_id','stage','summary','outcome','expected_reply_id','expected_version'],work_plan:['job_id','event_id','title','goal','plan','expected_revision'],work_correct:['job_id','event_id','expected_reply_id','expected_version','body','correction_summary']};
  if(!allowed[op])fail(400,'Invalid Muse work operation');fields(input,['op','token_hash',...allowed[op]],['op']);
  if(owner?!['work_list','work_read','work_create','work_cancel','work_retry'].includes(op):!['work_list','work_read','work_claim','work_update','work_plan','work_correct'].includes(op))fail(403,'Wrong Muse work authority');
  if(op==='work_list'){const after=cursor(input.after)||0,selected=rows(ctx,'SELECT seq,value FROM relay_mast_work WHERE seq>? ORDER BY seq LIMIT 51',after);return {jobs:selected.slice(0,50).map(r=>view(ctx,JSON.parse(r.value),now)),nextCursor:selected.length>50?String(selected[49].seq):null};}
  if(op==='work_create'){
    const spec=relayOwnerJobSpecification(input),original=rows(ctx,"SELECT * FROM relay_mast_entries WHERE id=? AND role='owner'",input.id||'')[0];if(!uuid(input.id)||typeof input.body!=='string'||!input.body.trim()&&!original||input.body.length>4000)fail(400,'Invalid Muse request');
    const prior=rows(ctx,'SELECT value FROM relay_mast_work WHERE id=?',input.id)[0];
    if(prior){const j=JSON.parse(prior.value);if(j.body!==input.body.trim()||j.device!==owner.device_id||canonical(j.spec)!==canonical(spec))fail(409,'Muse request ID conflict');return {job:view(ctx,j,now),newWrite:false};}
    if(original){if(original.body!==input.body.trim())fail(409,'Original Muse request body is immutable');}
    else{if(rows(ctx,'SELECT id FROM relay_mast_entries WHERE id=?',input.id).length)fail(409,'Muse message identity conflict');send({id:input.id,body:input.body});}
    const j={id:input.id,title:spec.title,body:input.body.trim(),spec,actionKind:spec.actionKind,device:owner.device_id,stage:'queued',outcome:'not_started',run:null,writer:null,expires:0,createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),cancelRequested:false,attempt:1,parentId:null,rootId:input.id,retryId:null,plan:null,corrections:[],completion:null};
    rows(ctx,'INSERT INTO relay_mast_work(id,value) VALUES(?,?)',j.id,JSON.stringify(j));return {job:view(ctx,j,now),newWrite:true};
  }
  const j=read(ctx,input.job_id);
  if(op==='work_read')return {job:view(ctx,j,now),events:rows(ctx,'SELECT id,arguments,created_ms FROM relay_mast_work_events WHERE job_id=? ORDER BY seq',j.id).map(r=>({id:r.id,...JSON.parse(r.arguments),token_hash:undefined,createdAt:new Date(r.created_ms).toISOString()}))};
  if(op==='work_retry'){
    if(!uuid(input.id)||input.id===j.id)fail(400,'Distinct retry request ID required');
    if(j.retryId){if(j.retryId!==input.id)fail(409,'Muse retry already exists');return {job:view(ctx,read(ctx,j.retryId),now),newWrite:false};}
    const shown=view(ctx,j,now);if(rows(ctx,"SELECT id FROM relay_mast_files WHERE message_id=? AND state='linked'",j.id).length)fail(409,'Attached requests require a new explicit message with reselected files');if(!shown.retryAllowed)fail(409,'Muse request cannot be retried');if(shown.retryRequiresConfirmation&&input.confirm_duplicate_risk!==true)fail(409,'Confirm duplicate execution risk before retry');
    if(input.confirm_duplicate_risk!==undefined&&typeof input.confirm_duplicate_risk!=='boolean')fail(400,'Invalid retry confirmation');
    const out=mastWork(ctx,{op:'work_create',id:input.id,body:j.body,title:j.spec.title,action_kind:j.actionKind,...(j.spec.projectTitle?{project_title:j.spec.projectTitle}:{}),...(j.spec.goalTitle?{goal_title:j.spec.goalTitle}:{})},{owner,writer,send,now});
    const child=read(ctx,out.job.id);child.attempt=j.attempt+1;child.parentId=j.id;child.rootId=j.rootId;child.plan=j.plan;write(ctx,child);j.retryId=child.id;write(ctx,j);return {job:view(ctx,child,now),newWrite:out.newWrite};
  }
  if(!uuid(input.event_id)||input.event_id===j.id)fail(400,'Distinct event ID required');
  const clean={...input};delete clean.token_hash;
  if(op==='work_cancel'){
    if(receipt(ctx,j,clean,'owner:'+owner.device_id,now))return {job:view(ctx,j,now),newWrite:false};
    if(['completed','failed','cancelled'].includes(j.stage))fail(409,'Muse request is already final');j.cancelRequested=true;
  }else{
    const name={work_claim:'relay_owner_job_claim',work_update:'relay_owner_job_update',work_plan:'relay_owner_job_plan',work_correct:'relay_owner_job_result_correct'}[op];
    relayOwnerJobValidateRpc(name,input);
    if(receipt(ctx,j,clean,writer,now))return {job:view(ctx,j,now),newWrite:false};
    if(op==='work_plan'){
      if((j.plan?.revision||0)!==input.expected_revision)fail(409,'Muse plan revision conflict');j.plan={revision:input.expected_revision+1,title:input.title.trim(),goal:input.goal.trim(),steps:input.plan.map(s=>s.trim())};
    }else if(op==='work_correct'){
      const history=results(ctx,j),last=history.at(-1);if(!last||history[0].id!==input.expected_reply_id||last.version!==input.expected_version||['failed','cancelled'].includes(j.stage))fail(409,'Muse result version conflict');
      if(history.length>=5)fail(429,'Muse correction limit reached');
      j.corrections.push({id:input.event_id,replyId:history[0].id,version:last.version+1,body:input.body.trim(),correctionSummary:input.correction_summary.trim(),createdAt:new Date(now).toISOString()});
      // The old attestation remains bound to its exact version, never the correction.
    }else if(op==='work_claim'){
      if(j.stage!=='queued'||j.run||j.cancelRequested||reply(ctx,j))fail(409,'Muse request cannot be claimed');
      j.run=input.run_id;j.writer=writer;j.expires=now+RELAY_OWNER_JOB_LEASE_MS;j.stage='running';j.outcome='unknown';
    }else{
      if(['completed','failed','cancelled'].includes(j.stage))fail(409,'Muse request is already final');
      if(input.stage==='cancelled'){
        if(!j.cancelRequested||input.outcome==='unknown')fail(409,'Known cancellation acknowledgement required');if(j.run)lease(j,writer,input.run_id,now,true);else if(input.outcome!=='not_started')fail(409,'Unclaimed request can only acknowledge not started');
      }else{
        lease(j,writer,input.run_id,now,input.stage==='completed');
        if(j.cancelRequested&&input.stage!=='completed')fail(409,'Acknowledge requested cancellation first');
        if(input.stage==='completed'){
          const history=results(ctx,j);if(!history.length||history[0].id!==input.expected_reply_id||history.at(-1).version!==input.expected_version)fail(409,'Exact accepted Muse result version required');
          j.completion={eventId:input.event_id,runId:j.run,replyId:input.expected_reply_id,resultVersion:input.expected_version,summary:input.summary.trim(),createdAt:new Date(now).toISOString(),authenticationSource:'mast-bearer-report'};
        }else if(!['running','waiting_for_owner'].includes(j.stage))fail(409,'Running or waiting Muse request required');
      }
      j.stage=input.stage;j.outcome=input.outcome||'unknown';if(input.stage==='running')j.expires=now+RELAY_OWNER_JOB_LEASE_MS;
      j.summary=input.summary?.trim()||'';
    }
  }
  j.updatedAt=new Date(now).toISOString();write(ctx,j);return {job:view(ctx,j,now),newWrite:true};
}
