import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {sha256} from './static-publication.mjs';
import {previousSource} from './rollback-pair-proof.mjs';
const execute=promisify(execFile);
export const ADVERSARIAL_TESTS=Object.freeze(['tests/relay-owner-jobs.test.js','tests/relay-owner-jobs-adversarial.test.js','tests/relay-events.test.js']);

// Reviewed CORE additions at a77ed42ba659010c477a4808a37d9d9d96896f4f.
// These are finite independent SQL contracts, not evaluation of source JS.
// A changed generator, constant, call site or unknown DDL still requires review.
const CORE_EVENT_TEMPLATE='CREATE INDEX IF NOT EXISTS relay_event_kind_seq ON relay_events((${eventKindSQL}),seq)';
const CORE_TRIGGER_TEMPLATE="CREATE TRIGGER IF NOT EXISTS relay_owner_job_change_${name} ${on} ${when ? 'WHEN ' + when : ''} BEGIN ${body} END";
const CORE_OWNER_SCHEMA_SHA256='f34c45f84f72e7d2379eec337663d4964078cab23deeaa36048d203c0a34923b';
const CORE_EVENT_DECLARATION_SHA256='9c8c1e320aa491a360ce668e7c1df94ae6c515b1f30f9e88e009ef53fa308226';
const OWNER='github:183016859';
const ownerChange=ids=>`INSERT OR REPLACE INTO relay_owner_job_changes(job_id)
  SELECT id FROM relay_owner_entries INDEXED BY sqlite_autoindex_relay_owner_entries_1
  WHERE kind='user' AND principal='${OWNER}' AND id IN (${ids});`;
const eventRequest=value=>`SELECT substr(message_id,7) FROM relay_events WHERE seq=${value} AND message_id LIKE 'owner:%'`;
const headRequest=value=>`SELECT substr(message_id,7) FROM (SELECT e.message_id FROM relay_outbox o INDEXED BY relay_outbox_unsettled
  JOIN relay_events e ON e.seq=o.event_seq WHERE o.subscription_id=${value} AND o.status IN ('pending','failed') ORDER BY o.event_seq LIMIT 1)`;
function coreOwnerTriggers(){
  const definitions=[],add=(name,on,when,body)=>definitions.push(`CREATE TRIGGER IF NOT EXISTS relay_owner_job_change_${name} ${on} ${when?'WHEN '+when:''} BEGIN ${body} END;`);
  const columns=['request_id','principal','device_id','title','action_kind','specified','stage','created_ms','updated_ms','finished_ms',
    'result_reply_id','parent_job_id','root_job_id','attempt','cancel_requested_ms','outcome','failure_code','failure_message',
    'lease_run_id','lease_grant_id','lease_expires_ms','acknowledged_ms'];
  for(const operation of ['INSERT','UPDATE']){
    const update=operation==='UPDATE',suffix=operation.toLowerCase();
    add('job_'+suffix,`AFTER ${operation} ON relay_owner_jobs`,update?columns.map(column=>`OLD.${column} IS NOT NEW.${column}`).join(' OR '):'',
      ownerChange('SELECT NEW.request_id UNION SELECT NEW.parent_job_id'+(update?' WHERE OLD.parent_job_id IS NOT NEW.parent_job_id UNION SELECT OLD.parent_job_id WHERE OLD.parent_job_id IS NOT NEW.parent_job_id':'')));
    add('lease_'+suffix,`AFTER ${operation} ON relay_owner_jobs`,update?'OLD.lease_expires_ms IS NOT NEW.lease_expires_ms':'NEW.lease_expires_ms IS NOT NULL',
      `DELETE FROM relay_owner_job_deadlines WHERE job_id=NEW.id AND source='lease';
       INSERT INTO relay_owner_job_deadlines(job_id,source,deadline_ms,expired) SELECT NEW.id,'lease',NEW.lease_expires_ms,0
       WHERE NEW.lease_expires_ms IS NOT NULL AND NEW.principal='${OWNER}';`);
    add('entry_'+suffix,`AFTER ${operation} ON relay_owner_entries`,(update?'(OLD.body IS NOT NEW.body OR OLD.created_at IS NOT NEW.created_at OR OLD.reply_to IS NOT NEW.reply_to) AND ':'')+`NEW.principal='${OWNER}'`,
      ownerChange("SELECT CASE WHEN NEW.kind='user' THEN NEW.id ELSE NEW.reply_to END"));
  }
  for(const table of ['relay_owner_job_events','relay_owner_job_result_corrections'])add(table+'_insert',`AFTER INSERT ON ${table}`,'',ownerChange('SELECT NEW.job_id'));
  for(const operation of ['INSERT','UPDATE','DELETE']){
    const update=operation==='UPDATE',value=operation==='DELETE'?'OLD':'NEW',suffix=operation.toLowerCase();
    add('event_'+suffix,`AFTER ${operation} ON relay_events`,`${update?'(OLD.message_id IS NOT NEW.message_id)':'1'} AND (${value}.message_id LIKE 'owner:%'${update?" OR OLD.message_id LIKE 'owner:%'":''})`,
      ownerChange(`SELECT substr(${value}.message_id,7)`+(update?' UNION SELECT substr(OLD.message_id,7)':'')));
    add('outbox_'+suffix,`AFTER ${operation} ON relay_outbox`,update?'OLD.status IS NOT NEW.status OR OLD.attempts IS NOT NEW.attempts OR OLD.last_error IS NOT NEW.last_error OR OLD.event_seq IS NOT NEW.event_seq OR OLD.subscription_id IS NOT NEW.subscription_id':'',
      ownerChange(`${eventRequest(value+'.event_seq')} UNION ${headRequest(value+'.subscription_id')}`+(update?' UNION '+eventRequest('OLD.event_seq')+' UNION '+headRequest('OLD.subscription_id'):'')));
    add('receipt_'+suffix,`AFTER ${operation} ON relay_delivery_receipts`,update?'OLD.accepted_ms IS NOT NEW.accepted_ms OR OLD.event_seq IS NOT NEW.event_seq':'',ownerChange(eventRequest(value+'.event_seq')));
    const deadline=operation==='DELETE'?'':`INSERT OR REPLACE INTO relay_owner_job_deadlines(job_id,source,deadline_ms,expired)
      SELECT id,'recovery:'||NEW.subscription_id||':'||NEW.event_seq,NEW.last_recovery_ms+60000,0
      FROM relay_owner_entries INDEXED BY sqlite_autoindex_relay_owner_entries_1
      WHERE kind='user' AND principal='${OWNER}' AND id IN (${eventRequest('NEW.event_seq')}) AND NEW.recoveries<2;`;
    add('recovery_'+suffix,`AFTER ${operation} ON relay_outbox_recoveries`,update?'OLD.recoveries IS NOT NEW.recoveries OR OLD.last_recovery_ms IS NOT NEW.last_recovery_ms':'',
      ownerChange(eventRequest(value+'.event_seq'))+`DELETE FROM relay_owner_job_deadlines
        WHERE job_id IN (${eventRequest(value+'.event_seq')}) AND source='recovery:'||${value}.subscription_id||':'||${value}.event_seq;`+deadline);
  }
  if(definitions.length!==20||new Set(definitions.map(sql=>sql.match(/^CREATE TRIGGER IF NOT EXISTS ([a-z_]+) /)[1])).size!==20)throw Error('Finite CORE trigger inventory required');
  return definitions;
}
async function coreSchemaStatement({path,code,text,git}){
  if(path==='backend/relay-events.js'&&text===CORE_EVENT_TEMPLATE){
    const declaration=code.match(/const eventKindSQL = `[\s\S]*?`;/g);
    if(declaration?.length!==1||sha256(declaration[0])!==CORE_EVENT_DECLARATION_SHA256)throw Error('Changed CORE routing expression requires migration review');
    const [common,tools]=await Promise.all([git(['show','backend/relay-common.js']),git(['show','backend/public-coordination-tools.js'])]);
    for(const [source,name,value] of [[common,'RELAY_OWNER_INBOX','brayden-owner'],[common,'RELAY_OWNER_EVENT','relay.owner.message.created'],
      [common,'RELAY_EVENT','relay.message.created'],[tools,'PUBLIC_RESULT_EVENT','relay.public.result.changed']]){
      if(source.split('\n').filter(line=>line===`export const ${name} = '${value}';`).length!==1)throw Error('Changed CORE routing constant requires migration review');
    }
    return {deferred:false,sql:["CREATE INDEX IF NOT EXISTS relay_event_kind_seq ON relay_events((CASE WHEN json_extract(data,'$.inbox_id')='brayden-owner' THEN 'relay.owner.message.created'\n  WHEN COALESCE(json_extract(data,'$.coordination_event_id'),'') NOT IN ('',0) THEN 'relay.public.result.changed' ELSE 'relay.message.created' END),seq);"]};
  }
  if(path==='backend/relay-owner-jobs.js'&&text===CORE_TRIGGER_TEMPLATE){
    const start=code.indexOf('const changeSQL = ids =>'),end=code.indexOf('\nconst changeWatermark');
    if(start<0||end<=start||sha256(code.slice(start,end))!==CORE_OWNER_SCHEMA_SHA256||/\bchangeTrigger\b/.test(code.slice(0,start)+code.slice(end)))throw Error('Changed CORE trigger generator requires migration review');
    const common=await git(['show','backend/relay-common.js']);
    if(common.split('\n').filter(line=>line===`export const RELAY_OWNER = '${OWNER}';`).length!==1)throw Error('Changed CORE trigger owner requires migration review');
    // All source tables must exist before their triggers. Preserve the original
    // literal DDL order and append this finite reviewed expansion afterwards.
    return {deferred:true,sql:coreOwnerTriggers()};
  }
  return null;
}
export async function schemaAt(source,commit,{runner=execute}={}){
  if(!/^[a-f0-9]{40}$/.test(commit||''))throw Error('Immutable schema source required');
  const git=async args=>(await runner('git',['-C',source,...args],{encoding:'utf8',timeout:10000,maxBuffer:2*1024*1024})).stdout;
  const files=(await git(['ls-tree','-r','--name-only',commit,'backend'])).trim().split('\n').filter(path=>/^backend\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.js$/.test(path));
  const rows=[],deferred=[];
  for(const path of files){
    const code=await git(['show',commit+':'+path]),statements=[];let extracted=0;
    for(const match of code.matchAll(/\.exec\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g)){
      const text=match[2].replace(/\\n/g,'\n').replace(/\\'/g,"'").replace(/\\"/g,'"').trim();
      if(!/^(?:CREATE|ALTER|DROP|RENAME)\s+(?:(?:UNIQUE|VIRTUAL)\s+)?(?:TABLE|INDEX|VIEW|TRIGGER)/i.test(text))continue;
      ++extracted;
      if(!/^CREATE (?:TABLE|(?:UNIQUE )?INDEX) IF NOT EXISTS /i.test(text)||text.includes('${')||text.includes('\\')){
        const reviewed=await coreSchemaStatement({path,code,text,git:args=>git([args[0],commit+':'+args[1]])});
        if(!reviewed)throw Error('Unsupported or destructive schema recipe requires migration review');
        if(reviewed.deferred)deferred.push(...reviewed.sql.map(sql=>({path,sql})));else statements.push(...reviewed.sql);
      }else statements.push(text.replace(/;\s*$/,'')+';');
    }
    const occurrences=[...code.matchAll(/\b(?:CREATE|ALTER|DROP|RENAME)\s+(?:(?:UNIQUE|VIRTUAL)\s+)?(?:TABLE|INDEX|VIEW|TRIGGER)\b/gi)].length;
    if(occurrences!==extracted)throw Error('Unresolved schema statement requires migration review');
    rows.push(...statements.map(sql=>({path,sql})));
  }
  rows.push(...deferred);
  if(rows.length<1||rows.length>1000)throw Error('Bounded complete schema contract required');
  return rows;
}
export async function rollbackPairContracts({root,previous,backend}){
  const source=join(root,'.jarvis-source'),before=await schemaAt(source,previousSource(previous)),after=await schemaAt(source,backend.candidate.source);
  // Bind and verify the complete tracked source closure, including transitive
  // test helpers, publication JSON and package locks. An edited helper must not
  // turn a failed pending-work check into an apparently qualified result.
  const rows=(await execute('git',['-C',source,'ls-tree','-rz',backend.candidate.source],{encoding:'utf8',maxBuffer:2*1024*1024})).stdout.split('\0').filter(Boolean);
  if(!rows.length||rows.length>10000)throw Error('Bounded immutable runtime source required');
  const runtime=[];
  for(const row of rows){
    const match=/^(100644|100755) blob ([a-f0-9]{40})\t([A-Za-z0-9_./-]+)$/.exec(row);
    if(!match||match[3].split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Unsupported immutable runtime source type');
    const [,mode,gitDigest,path]=match,bytes=await readFile(join(source,path)),info=await lstat(join(source,path));
    const actual=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
    if(!info.isFile()||info.isSymbolicLink()||((info.mode&0o111)?'100755':'100644')!==mode||actual!==gitDigest)throw Error('Candidate runtime/fixture differs from its immutable source');
    runtime.push({path,mode,sha256:sha256(bytes)});
  }
  return {before,after,schemaInputsDigest:sha256({before,after}),pendingRuntimeDigest:sha256(runtime),
    runtimeRecipeDigest:sha256(await Promise.all(['scripts/rollback-pair-runtime.mjs','tests/fixtures/release-recovery/schema-recovery.py'].map(async path=>({path,sha256:sha256(await readFile(join(root,path)))}))))};
}
