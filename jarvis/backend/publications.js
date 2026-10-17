import {sharedStore,sharedSchema,seedLegacyInbox,nextLegacyInboxAt,syncLegacyInbox} from './shared.js';
import {decodeCoordination,backfillPublicChanges} from './public-coordination.js';
import {canonical} from './relay-common.js';
export const COMMENTS_URL='https://api.github.com/repos/braydenparker999/jarvis/issues/2/comments';
export const ISSUE_URL='https://api.github.com/repos/braydenparker999/jarvis/issues/2';
export const COMMENT_URL='https://api.github.com/repos/braydenparker999/jarvis/issues/comments/';
const OWNER=183016859, INTERVAL=300000;
export const PUBLICATION_LIMITS=Object.freeze({intervalMs:INTERVAL,continuationMs:60000,maxIdleMs:1800000,
  pagesPerRun:3,commentsPerPage:100,pendingPerRun:600,conflictsPerRun:100,backfillPerRun:100,
  reconcileFetchesPerHour:36,reconcileFetchesPerDay:288,hintFetchesPerHour:12,totalFetchesPerHour:48,
  passesPerDay:480,pendingPerHour:7200,pendingPerDay:28800,conflictsPerHour:1200,conflictsPerDay:4800,
  backfillPerHour:6000,backfillPerDay:12000});
const schemas=new WeakSet(),sharedMetadata=new WeakSet(),inFlight=new WeakMap();
const GITHUB_HEADERS={Accept:'application/vnd.github+json','User-Agent':'Jarvis-publications','X-GitHub-Api-Version':'2022-11-28'};
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
const nonempty=(x,max)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
export function decodePublication(comment) {
  if(comment?.user?.id!==OWNER||!Number.isSafeInteger(comment.id)||comment.id<1||typeof comment.body!=='string'||comment.body.length>30000)return null;
  let p;try{p=JSON.parse(comment.body);}catch{return null;}
  if (p?.schema === 'jarvis-coordination-v2') {
    if (!decodeCoordination(p) || !Number.isFinite(Date.parse(comment.created_at))) return null;
    return {type:'coordination',payload:p,provenance:{source:'github-issue',repository:'braydenparker999/jarvis',issue:2,
      commentId:comment.id,authorId:OWNER,publishedAt:comment.created_at}};
  }
  if(!p||p.schema!=='jarvis-publication-v1'||!uuid(p.id)||!['reply','briefing'].includes(p.type)||!nonempty(p.body,p.type==='briefing'?20000:6000)||!Number.isFinite(Date.parse(comment.created_at)))return null;
  if(p.type==='reply'&&!uuid(p.replyTo))return null;
  if(p.type==='briefing'&&(!nonempty(p.title,120)||typeof p.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!Number.isFinite(Date.parse(p.date))||new Date(p.date).toISOString().slice(0,10)!==p.date))return null;
  return {id:p.id,body:p.body.trim(),createdAt:comment.created_at,type:p.type,
    ...(p.type==='reply'?{replyTo:p.replyTo}:{title:p.title.trim(),date:p.date})};
}
async function boundedJson(response,limit=2000000) {
  const reader=response.body?.getReader();if(!reader)throw Error('GitHub returned an empty response');
  let size=0;const chunks=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('GitHub response exceeded the import limit');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function publicationSchema(ctx) {
  if(schemas.has(ctx))return;
  sharedSchema(ctx);
  sharedMetadata.add(ctx);
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS imported_comments (comment_id INTEGER PRIMARY KEY, publication TEXT NOT NULL, imported INTEGER NOT NULL DEFAULT 0, error TEXT)');
  ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS imported_comments_status ON imported_comments(imported,comment_id)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS publication_recovery (comment_id INTEGER PRIMARY KEY)');
  if(!meta(ctx,'publisher-v2-pending-compatibility')){
    const through=rows(ctx,'SELECT COALESCE(MAX(comment_id),0) AS n FROM imported_comments WHERE imported=0')[0].n;
    putMeta(ctx,'publisher-v2-pending-compatibility',{after:0,through,complete:through===0});
  }
  schemas.add(ctx);
}
const meta=(ctx,key)=>JSON.parse([...ctx.storage.sql.exec('SELECT value FROM shared_meta WHERE key=?',key)][0]?.value||'null');
const putMeta=(ctx,key,value)=>ctx.storage.sql.exec('INSERT OR REPLACE INTO shared_meta VALUES(?,?)',key,JSON.stringify(value));
// Shared across all anonymous hints and normal reads, not per browser/IP. Hints
// cannot exhaust the reconciler's reserved maximum of 36 hourly requests.
export function takePublicationFetch(ctx,kind,now=Date.now()) {
  const upstream=Number(meta(ctx,'publisher-upstream-not-before')||0);
  if(now<upstream)return {ok:false,retryAt:upstream,reason:'github_backoff'};
  const hour=Math.floor(now/3600000),minute=Math.floor(now/60000);
  const stored=meta(ctx,'publisher-egress-budget');
  if(stored?.hour>hour)return {ok:false,retryAt:stored.hour*3600000,reason:'clock_backoff'};
  const budget=stored?.hour===hour?stored:{hour,total:0,hints:0,reconcile:0,minute,burst:0};
  budget.reconcile??=budget.total-budget.hints;
  if(budget.minute>minute)return {ok:false,retryAt:budget.minute*60000,reason:'clock_backoff'};
  if(budget.minute!==minute){budget.minute=minute;budget.burst=0;}
  if(budget.total>=48||kind==='hint'&&budget.hints>=12||kind==='reconcile'&&budget.reconcile>=36)return {ok:false,retryAt:(hour+1)*3600000,reason:'egress_budget'};
  if(kind==='hint'&&budget.burst>=2)return {ok:false,retryAt:(minute+1)*60000,reason:'hint_burst'};
  if(kind==='reconcile'){
    const day=Math.floor(now/86400000),storedDay=meta(ctx,'publisher-reconcile-day');
    if(storedDay?.day>day)return {ok:false,retryAt:storedDay.day*86400000,reason:'clock_backoff'};
    const daily=storedDay?.day===day?storedDay:{day,total:0};
    if(daily.total>=288)return {ok:false,retryAt:(day+1)*86400000,reason:'daily_egress_budget'};
    daily.total++;putMeta(ctx,'publisher-reconcile-day',daily);budget.reconcile++;
  }
  budget.total++;if(kind==='hint'){budget.hints++;budget.burst++;}putMeta(ctx,'publisher-egress-budget',budget);
  return {ok:true};
}
export function publicationBackoff(ctx,response,now=Date.now()) {
  if(![403,429].includes(response.status)&&response.headers.get('x-ratelimit-remaining')!=='0')return;
  const reset=Number(response.headers.get('x-ratelimit-reset'))*1000;
  const retryText=response.headers.get('retry-after'),seconds=retryText===null?NaN:Number(retryText);
  const retry=Number.isFinite(seconds)?now+seconds*1000:Date.parse(retryText);
  const retryAt=Math.max(now+INTERVAL,Number.isFinite(reset)?reset+1000:0,Number.isFinite(retry)?retry:0);
  putMeta(ctx,'publisher-upstream-not-before',Math.max(Number(meta(ctx,'publisher-upstream-not-before')||0),retryAt));
}
function legacyUpdate(p, commentId) {
  return {payload:{schema:'jarvis-publication-v1-update',eventId:p.id,requestId:p.replyTo,attemptId:p.id,stage:'final',
    body:p.body,artifacts:[],resultVersion:1},provenance:{source:'github-issue',repository:'braydenparker999/jarvis',issue:2,
    commentId,authorId:OWNER,publishedAt:p.createdAt,legacyConflict:true}};
}
const rows=(ctx,q,...args)=>[...ctx.storage.sql.exec(q,...args)];
const pending=item=>item.imported===0||item.imported===-1;
// c4 selects exactly imported=0 and understands only legacy publications. New
// coordination dependencies use -1 before any await and remain private to this
// importer until they become accepted (1) or a durable conflict (2).
const pendingDisposition=p=>p.type==='coordination'?-1:0;
// A retained ccf journal can still contain unsafe coordination rows at 0. Keep
// this candidate running until its bounded examined-prefix sweep completes
// before switching to c4; false/absent is not permission to roll back. New rows
// are already safe, and this checkpoint never deletes accepted publications.
export function publicationRollbackCompatible(ctx) {
  return meta(ctx,'publisher-v2-pending-compatibility')?.complete===true;
}
function pendingPage(ctx,after,limit) {
  const legacy=rows(ctx,'SELECT * FROM imported_comments WHERE imported=0 AND comment_id>? ORDER BY comment_id LIMIT ?',after,limit);
  const coordination=rows(ctx,'SELECT * FROM imported_comments WHERE imported=-1 AND comment_id>? ORDER BY comment_id LIMIT ?',after,limit);
  // Both ranges use imported_comments_status. Merge at most 2*limit in memory;
  // IN(... ) ORDER BY would otherwise sort an arbitrarily large pending journal.
  const result=[];let a=0,b=0;
  while(result.length<limit&&(a<legacy.length||b<coordination.length))
    result.push(b>=coordination.length||a<legacy.length&&legacy[a].comment_id<coordination[b].comment_id?legacy[a++]:coordination[b++]);
  return result;
}
function repairPendingCompatibility(ctx,now,work) {
  const checkpoint=meta(ctx,'publisher-v2-pending-compatibility');
  if(checkpoint.complete)return;
  const limit=allowance(ctx,'pending',Math.min(100,work.pending),now);if(!limit)return;
  const page=rows(ctx,'SELECT comment_id,publication FROM imported_comments WHERE imported=0 AND comment_id>? AND comment_id<=? ORDER BY comment_id LIMIT ?',
    checkpoint.after,checkpoint.through,limit);
  charge(ctx,'pending',page.length,now);work.pending-=page.length;
  ctx.storage.transactionSync(()=>{
    for(const item of page)if(JSON.parse(item.publication).type==='coordination')
      ctx.storage.sql.exec('UPDATE imported_comments SET imported=-1 WHERE comment_id=? AND imported=0',item.comment_id);
    const after=page.length===limit?page.at(-1).comment_id:checkpoint.through;
    putMeta(ctx,'publisher-v2-pending-compatibility',{...checkpoint,after,complete:after>=checkpoint.through});
  });
}
const generation=ctx=>rows(ctx,'SELECT COALESCE(MAX(seq),0) AS n FROM public_changes')[0].n;
const conflictTail=ctx=>rows(ctx,'SELECT COALESCE(MAX(comment_id),0) AS n FROM imported_comments WHERE imported=2')[0].n;
function allowance(ctx,kind,limit,now) {
  const hour=Math.floor(now/3600000),day=Math.floor(now/86400000),stored=meta(ctx,'publisher-work:'+kind);
  if(stored&&(hour<stored.hour||day<stored.day))return 0;
  return Math.max(0,Math.min(limit,PUBLICATION_LIMITS[kind+'PerHour']-(stored?.hour===hour?stored.hourly:0),
    PUBLICATION_LIMITS[kind+'PerDay']-(stored?.day===day?stored.daily:0)));
}
function charge(ctx,kind,count,now) {
  if(!count)return;
  const hour=Math.floor(now/3600000),day=Math.floor(now/86400000),stored=meta(ctx,'publisher-work:'+kind);
  putMeta(ctx,'publisher-work:'+kind,{hour,day,hourly:(stored?.hour===hour?stored.hourly:0)+count,daily:(stored?.day===day?stored.daily:0)+count});
}
async function applyItem(ctx,item) {
  const p=JSON.parse(item.publication),sql=ctx.storage.sql;
  if(p.type==='coordination'&&item.imported===0)
    sql.exec('UPDATE imported_comments SET imported=-1 WHERE comment_id=? AND imported=0',item.comment_id);
  const r=sharedStore(ctx,p.type==='coordination'?'/internal/shared/coordination':p.type==='reply'?'/internal/shared/reply':'/internal/shared/briefing',p);
  if(r.ok){sql.exec('UPDATE imported_comments SET imported=1,error=NULL WHERE comment_id=?',item.comment_id);return true;}
  if(r.status===409){
    let failure=p.type==='coordination'?await r.json():null;
    if(p.type==='reply'){
      const update=sharedStore(ctx,'/internal/shared/coordination',legacyUpdate(p,item.comment_id));
      if(!update.ok)failure=await update.json();
      if(update.status===404)sql.exec('INSERT OR IGNORE INTO publication_recovery VALUES(?)',item.comment_id);
    }
    sql.exec('UPDATE imported_comments SET imported=2,error=? WHERE comment_id=?',failure?.code||'Conflicting publication; original kept',item.comment_id);return true;
  }
  if(![404,425].includes(r.status))throw Error('Publication could not be saved');
  return false;
}
export async function applyPendingPublications(ctx,{now=Date.now(),work={pending:600,conflicts:100},commentId=null,recover=true}={}) {
  publicationSchema(ctx);
  let examined=0,progressed=false;
  // An authenticated exact-target hint is never starved behind old dependencies.
  if(commentId!==null&&work.pending&&allowance(ctx,'pending',1,now)){
    const item=rows(ctx,'SELECT * FROM imported_comments WHERE comment_id=? AND imported IN(0,-1)',commentId)[0];
    if(item){charge(ctx,'pending',1,now);work.pending--;examined++;progressed=await applyItem(ctx,item);}
  }
  for(let round=0;round<8&&work.pending;round++){
    const limit=allowance(ctx,'pending',Math.min(100,work.pending),now);if(!limit)break;
    const after=Number(meta(ctx,'publisher-pending-cursor')||0);
    const page=pendingPage(ctx,after,limit);
    if(!page.length){if(after)putMeta(ctx,'publisher-pending-cursor',0);if(after&&progressed)continue;break;}
    charge(ctx,'pending',page.length,now);work.pending-=page.length;examined+=page.length;
    let advanced=false;for(const item of page)if(await applyItem(ctx,item))advanced=true;
    progressed ||= advanced;
    putMeta(ctx,'publisher-pending-cursor',page.length===limit?page.at(-1).comment_id:0);
    if(!advanced&&page.length<limit&&after===0)break;
  }
  if(recover&&work.conflicts){
    let limit=allowance(ctx,'conflicts',Math.min(100,work.conflicts),now);
    const after=Number(meta(ctx,'publisher-conflict-cursor')||0);
    const page=limit?rows(ctx,'SELECT * FROM imported_comments WHERE imported=2 AND comment_id>? ORDER BY comment_id LIMIT ?',after,limit):[];
    charge(ctx,'conflicts',page.length,now);work.conflicts-=page.length;
    for(const item of page){
      const p=JSON.parse(item.publication);
      if(p.type==='reply'&&!rows(ctx,'SELECT event_id FROM public_coordination_events WHERE event_id=?',p.id).length){
        const response=sharedStore(ctx,'/internal/shared/coordination',legacyUpdate(p,item.comment_id));
        if(response.status===404)ctx.storage.sql.exec('INSERT OR IGNORE INTO publication_recovery VALUES(?)',item.comment_id);
        else if(!response.ok&&response.status!==409)throw Error('Legacy conflict recovery unavailable');
      }
    }
    if(page.length)putMeta(ctx,'publisher-conflict-cursor',page.at(-1).comment_id);
    limit=allowance(ctx,'conflicts',Math.min(100,work.conflicts),now);
    const retryAfter=Number(meta(ctx,'publisher-recovery-cursor')||0);
    const retry=limit?rows(ctx,`SELECT i.* FROM publication_recovery r JOIN imported_comments i ON i.comment_id=r.comment_id
      WHERE r.comment_id>? ORDER BY r.comment_id LIMIT ?`,retryAfter,limit):[];
    charge(ctx,'conflicts',retry.length,now);work.conflicts-=retry.length;
    for(const item of retry){
      const response=sharedStore(ctx,'/internal/shared/coordination',legacyUpdate(JSON.parse(item.publication),item.comment_id));
      if(response.ok||response.status===409)ctx.storage.sql.exec('DELETE FROM publication_recovery WHERE comment_id=?',item.comment_id);
      else if(response.status!==404)throw Error('Legacy conflict recovery unavailable');
    }
    if(retry.length||retryAfter)putMeta(ctx,'publisher-recovery-cursor',retry.length===limit&&limit?retry.at(-1).comment_id:0);
  }
  return {examined,progressed,more:!!meta(ctx,'publisher-pending-cursor')||conflictTail(ctx)>Number(meta(ctx,'publisher-conflict-cursor')||0)||!!meta(ctx,'publisher-recovery-cursor')};
}
export function seedPublicationReconciliation(ctx,now=Date.now(),env=null,{initialAlarmDelay=0}={}) {
  publicationSchema(ctx);
  if(!meta(ctx,'publisher-reconciliation-enabled')){
    putMeta(ctx,'publisher-reconciliation-enabled',true);
    if(meta(ctx,'publisher-next-attempt')===null)putMeta(ctx,'publisher-next-attempt',now);
    if(meta(ctx,'publisher-local-next-attempt')===null)putMeta(ctx,'publisher-local-next-attempt',now);
    // A first public write seeds maintenance without displacing a nearer Relay
    // delivery retry. This affects scheduling only; an explicit read can still
    // admit immediate bounded reconciliation and clear this one-time marker.
    if(Number.isSafeInteger(initialAlarmDelay)&&initialAlarmDelay>0)
      putMeta(ctx,'publisher-initial-alarm-not-before',now+Math.min(INTERVAL,initialAlarmDelay));
  }
  if(env?.HUBS)seedLegacyInbox(ctx,now);
}
export function nextPublicationReconciliationAt(ctx,now=Date.now()) {
  // Private delivery scheduling must not initialize a public lane. Probe the
  // table itself without reading rows or scanning the schema catalog; cache only
  // positive existence so a later legitimate public seed is immediately visible.
  if(!sharedMetadata.has(ctx)){
    try{ctx.storage.sql.exec('SELECT value FROM shared_meta LIMIT 0');sharedMetadata.add(ctx);}
    catch(error){if(/\bno such table:\s*(?:main\.)?shared_meta\b/i.test(error?.message||''))return null;throw error;}
  }
  if(!meta(ctx,'publisher-reconciliation-enabled'))return null;
  const blocked=Math.max(Number(meta(ctx,'publisher-pass-not-before')||0),Number(meta(ctx,'publisher-initial-alarm-not-before')||0));
  const main=Math.max(Number(meta(ctx,'publisher-next-attempt')||now),Number(meta(ctx,'publisher-upstream-not-before')||0));
  const times=[main,meta(ctx,'publisher-local-next-attempt'),nextLegacyInboxAt(ctx)].filter(x=>x!==null);
  return Math.max(blocked,Math.min(...times));
}
// The caller has already validated a shared read and initialized sharedSchema.
// This check performs indexed reads only. It lets the alarm composer persist a
// wake before a pass that may commit, while warmed no-op reads remain read-only.
export function publicationReadNeedsWake(ctx,now=Date.now(),env=null) {
  if(!meta(ctx,'publisher-reconciliation-enabled')||env?.HUBS&&!meta(ctx,'legacy-inbox-checkpoint'))return true;
  if(now<Number(meta(ctx,'publisher-pass-not-before')||0))return false;
  return now>=Number(meta(ctx,'publisher-local-next-attempt')||0)||generation(ctx)!==meta(ctx,'publisher-local-generation')||
    conflictTail(ctx)!==Number(meta(ctx,'publisher-conflict-observed-tail')||0)||
    now>=Math.max(Number(meta(ctx,'publisher-next-attempt')||0),Number(meta(ctx,'publisher-upstream-not-before')||0))||
    !!(env?.HUBS&&now>=Number(nextLegacyInboxAt(ctx)));
}
function takePass(ctx,now) {
  const day=Math.floor(now/86400000),stored=meta(ctx,'publisher-pass-budget');
  if(stored?.day>day||stored?.day===day&&stored.total>=PUBLICATION_LIMITS.passesPerDay){
    putMeta(ctx,'publisher-pass-not-before',(Math.max(day,stored.day)+1)*86400000);return false;
  }
  putMeta(ctx,'publisher-pass-budget',{day,total:(stored?.day===day?stored.total:0)+1});return true;
}
function summary(ctx) {
  const pending=rows(ctx,'SELECT comment_id FROM imported_comments WHERE imported IN(0,-1) LIMIT 601').length;
  const conflicts=rows(ctx,'SELECT comment_id FROM imported_comments WHERE imported=2 LIMIT 101').length;
  return {pending:Math.min(pending,600),conflicts:Math.min(conflicts,100),morePending:pending>600,moreConflicts:conflicts>100};
}
function publicationCoverage(ctx) {
  // c4 advances its since/scan even for v2 comments it cannot decode. Only this
  // candidate-owned checkpoint proves complete v2 coverage; absent older state
  // starts a bounded replay from the beginning, never from c4's watermark.
  const coverage=meta(ctx,'publisher-v2-coverage')??{v:1,since:null,scan:null};
  const timestamp=value=>value===null||typeof value==='string'&&value.length<=64&&Number.isFinite(Date.parse(value));
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
  if(!object(coverage)||Object.keys(coverage).sort().join(',')!=='scan,since,v'||coverage.v!==1||!timestamp(coverage.since)||
    coverage.scan!==null&&(!object(coverage.scan)||Object.keys(coverage.scan).sort().join(',')!=='newest,page,since'||
      coverage.scan.since!==coverage.since||!Number.isSafeInteger(coverage.scan.page)||coverage.scan.page<1||!timestamp(coverage.scan.newest)))
    throw Error('Publication coverage checkpoint unavailable');
  const changed=meta(ctx,'publisher-since')!==coverage.since||canonical(meta(ctx,'publisher-scan'))!==canonical(coverage.scan);
  // Another c4 phase may have changed a partial offset as well as the cutoff.
  // Restart only that partial scan from our last fully completed coverage.
  return {coverage,scan:!changed&&coverage.scan||{since:coverage.since,page:1,newest:null}};
}
function savePublicationCoverage(ctx,coverage) {
  putMeta(ctx,'publisher-v2-coverage',coverage);
  // Keep the old diagnostic fields as actual mirrors, including a null since
  // during first-page replay. A stale high cutoff would otherwise look like a
  // new c4 interruption and repeatedly rewind that replay on every restart.
  if(coverage.since===null)ctx.storage.sql.exec("DELETE FROM shared_meta WHERE key='publisher-since'");
  else putMeta(ctx,'publisher-since',coverage.since);
  if(coverage.scan===null)ctx.storage.sql.exec("DELETE FROM shared_meta WHERE key='publisher-scan'");
  else putMeta(ctx,'publisher-scan',coverage.scan);
}
async function reconcile(ctx,fetcher,now,env) {
  seedPublicationReconciliation(ctx,now,env);
  const localDue=now>=Number(meta(ctx,'publisher-local-next-attempt')||0)||generation(ctx)!==meta(ctx,'publisher-local-generation')||
    conflictTail(ctx)!==Number(meta(ctx,'publisher-conflict-observed-tail')||0);
  const networkDue=now>=Math.max(Number(meta(ctx,'publisher-next-attempt')||0),Number(meta(ctx,'publisher-upstream-not-before')||0));
  const legacyDue=env?.HUBS&&now>=Number(nextLegacyInboxAt(ctx));
  if(!localDue&&!networkDue&&!legacyDue||now<Number(meta(ctx,'publisher-pass-not-before')||0)||!takePass(ctx,now))return;
  const sql=ctx.storage.sql,work={pending:600,conflicts:100};
  if(meta(ctx,'publisher-initial-alarm-not-before')!==null)
    sql.exec("DELETE FROM shared_meta WHERE key='publisher-initial-alarm-not-before'");
  let localMore=false;
  // Persist all cooldowns before asynchronous work; process loss never rewinds a
  // committed page, and shared-object concurrency cannot multiply this pass.
  putMeta(ctx,'publisher-local-next-attempt',now+INTERVAL);
  try {
    repairPendingCompatibility(ctx,now,work);
    if(legacyDue)await syncLegacyInbox(ctx,env,now);
    const backfillLimit=meta(ctx,'public-changes-backfill')?allowance(ctx,'backfill',PUBLICATION_LIMITS.backfillPerRun,now):0;
    // Reserve the bounded batch before its atomic writes. A process loss after
    // checkpointing cannot spend the same daily write allowance again.
    if(backfillLimit)charge(ctx,'backfill',backfillLimit,now);
    if(backfillLimit)backfillPublicChanges(ctx,backfillLimit);
    localMore=!!meta(ctx,'public-changes-backfill');
    if(localDue||legacyDue){
      // Keep capacity for newly verified pages even when old missing originals
      // fill the pending journal. The durable cursor resumes the older tail.
      const initial={pending:networkDue?Math.min(200,work.pending):work.pending,conflicts:work.conflicts};
      const admitted=initial.pending,applied=await applyPendingPublications(ctx,{now,work:initial});
      work.pending-=admitted-initial.pending;work.conflicts=initial.conflicts;localMore ||= applied.more;
    }
    if(networkDue){
      putMeta(ctx,'publisher-next-attempt',now+INTERVAL);
      const {coverage,scan}=publicationCoverage(ctx);
      let complete=false,newPublications=0;
      for(let pages=0;pages<PUBLICATION_LIMITS.pagesPerRun;pages++){
        const permit=takePublicationFetch(ctx,'reconcile',now);
        if(!permit.ok){putMeta(ctx,'publisher-next-attempt',permit.retryAt);throw Object.assign(Error('GitHub publication sync waiting for '+permit.reason),{reason:permit.reason});}
        const url=new URL(COMMENTS_URL);url.searchParams.set('per_page','100');url.searchParams.set('page',String(scan.page));
        if(scan.since)url.searchParams.set('since',scan.since);
        const response=await fetcher(url.href,{headers:GITHUB_HEADERS,redirect:'manual',signal:AbortSignal.timeout(3500)});
        publicationBackoff(ctx,response,now);
        if(!response.ok)throw Object.assign(Error('GitHub publication sync returned '+response.status),{status:response.status});
        const comments=await boundedJson(response);
        if(!Array.isArray(comments)||comments.length>100)throw Error('GitHub returned invalid publication data');
        const admitted=[];
        ctx.storage.transactionSync(()=>{
          for(const comment of comments){
            if(Number.isFinite(Date.parse(comment?.updated_at))&&(!scan.newest||Date.parse(comment.updated_at)>Date.parse(scan.newest)))scan.newest=comment.updated_at;
            const p=decodePublication(comment);
            if(p){sql.exec('INSERT OR IGNORE INTO imported_comments(comment_id,publication,imported) VALUES(?,?,?)',comment.id,JSON.stringify(p),pendingDisposition(p));newPublications++;admitted.push(comment.id);}
          }
          scan.page++;
          if(comments.length<100){
            complete=true;
            if(scan.newest){
              const since=new Date(Date.parse(scan.newest)-1000).toISOString();
              if(coverage.since===null||Date.parse(since)>Date.parse(coverage.since))coverage.since=since;
            }
            coverage.scan=null;
          }else coverage.scan=scan;
          // Journal, examined page and both compatibility mirrors commit or
          // roll back together. Only a complete scan advances covered since.
          savePublicationCoverage(ctx,coverage);
        });
        for(const id of new Set(admitted))if(work.pending&&allowance(ctx,'pending',1,now)){
          const item=rows(ctx,'SELECT * FROM imported_comments WHERE comment_id=? AND imported IN(0,-1)',id)[0];
          if(item){charge(ctx,'pending',1,now);work.pending--;await applyItem(ctx,item);}
        }
        const reserved=complete?0:(PUBLICATION_LIMITS.pagesPerRun-pages-1)*PUBLICATION_LIMITS.commentsPerPage;
        const local={pending:Math.max(0,work.pending-reserved),conflicts:work.conflicts},available=local.pending;
        const applied=await applyPendingPublications(ctx,{now,work:local});
        work.pending-=available-local.pending;work.conflicts=local.conflicts;localMore ||= applied.more;
        if(complete||now<Number(meta(ctx,'publisher-upstream-not-before')||0))break;
      }
      const idle=complete&&!newPublications?Math.min(Number(meta(ctx,'publisher-idle')||0)+1,4):0;
      putMeta(ctx,'publisher-idle',idle);
      putMeta(ctx,'publisher-next-attempt',Math.max(now+(complete?Math.min(1800000,INTERVAL*2**Math.max(0,idle-1)):INTERVAL),Number(meta(ctx,'publisher-upstream-not-before')||0)));
      putMeta(ctx,'publisher-status',{ok:true,lastAttempt:new Date(now).toISOString(),lastSuccessfulSync:new Date(now).toISOString(),
        catchingUp:!complete,...summary(ctx)});
    }
  }catch(error){
    const retryAt=Math.max(Number(meta(ctx,'publisher-next-attempt')||now+INTERVAL),Number(meta(ctx,'publisher-upstream-not-before')||0));
    putMeta(ctx,'publisher-next-attempt',retryAt);
    putMeta(ctx,'publisher-status',{...meta(ctx,'publisher-status'),ok:false,lastAttempt:new Date(now).toISOString(),
      error:error.message||'Publication sync unavailable',...(error.status?{httpStatus:error.status}:{}),
      ...(error.reason?{reason:error.reason}:{}),retryAt:new Date(retryAt).toISOString(),...summary(ctx)});
  }finally{
    putMeta(ctx,'publisher-local-generation',generation(ctx));
    putMeta(ctx,'publisher-conflict-observed-tail',conflictTail(ctx));
    // Exhausted local budgets defer to their next reset, never a fast alarm loop.
    let localNext=now+(localMore||!publicationRollbackCompatible(ctx)?PUBLICATION_LIMITS.continuationMs:PUBLICATION_LIMITS.maxIdleMs);
    for(const kind of ['pending','conflicts','backfill'])if(!allowance(ctx,kind,1,now)){
      const budget=meta(ctx,'publisher-work:'+kind);
      localNext=Math.max(localNext,(Math.max(Math.floor(now/3600000),budget?.hour||0)+1)*3600000,
        budget?.daily>=PUBLICATION_LIMITS[kind+'PerDay']?(budget.day+1)*86400000:0);
    }
    putMeta(ctx,'publisher-local-next-attempt',localNext);
    const status=meta(ctx,'publisher-status');
    if(status)putMeta(ctx,'publisher-status',{...status,...summary(ctx),reconciliation:{enabled:true,
      nextAttemptAt:new Date(nextPublicationReconciliationAt(ctx,now)).toISOString(),localCatchingUp:localMore,
      legacy:meta(ctx,'legacy-inbox-status')}});
  }
}
export async function syncPublications(ctx,fetcher=fetch,now=Date.now(),env=null) {
  if(inFlight.has(ctx))return inFlight.get(ctx);
  const running=reconcile(ctx,fetcher,now,env);inFlight.set(ctx,running);
  try{return await running;}finally{if(inFlight.get(ctx)===running)inFlight.delete(ctx);}
}

function hintReceipt(ctx,commentId) {
  const item=[...ctx.storage.sql.exec('SELECT * FROM imported_comments WHERE comment_id=?',commentId)][0];
  if(!item)return null;
  const publication=JSON.parse(item.publication),id=publication.type==='coordination'?publication.payload.eventId:publication.id;
  const event=publication.type==='reply'&&item.imported===2?[...ctx.storage.sql.exec('SELECT request_id,payload,disposition,error_code FROM public_coordination_events WHERE event_id=?',id)][0]:null;
  const matches=event&&event.request_id===publication.replyTo&&event.payload===canonical(legacyUpdate(publication,commentId).payload);
  const update=matches&&event.disposition==='accepted';
  // Older rejected legacy rows kept only a generic conflict diagnostic. Their
  // durable event proves a precise ID/payload conflict without changing history.
  const errorCode=event&&!matches?'event_id_conflict':event?.error_code||item.error;
  return Response.json({commentId,publicationId:id,status:pending(item)?'pending':update?'update-imported':item.imported===1?'imported':'conflict',
    ...(item.imported===2&&!update?{errorCode}:{}),public_inbox:true,execution_authorized:false},
    {status:pending(item)?202:item.imported===2&&!update?409:200});
}
export async function importPublicationHint(ctx,input,fetcher=fetch,now=Date.now(),admitMutation=operation=>operation()) {
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||!Number.isSafeInteger(input.commentId)||input.commentId<1)
    return Response.json({error:'Expected only a positive numeric commentId'},{status:400});
  publicationSchema(ctx);
  const sql=ctx.storage.sql,commentId=input.commentId;
  // Durable retries are cheap indexed receipts. Pending dependencies remain in
  // the journal and recover through the unchanged read-triggered reconciler.
  // An older importer may already have journaled this exact legacy final as a
  // conflict. Recover that one target, preserving the immutable original reply,
  // instead of scanning every historical conflict before admitting a new hint.
  const stored=[...sql.exec('SELECT publication,imported FROM imported_comments WHERE comment_id=?',commentId)][0];
  if(stored?.imported===2){
    const p=JSON.parse(stored.publication);
    if(p.type==='reply'&&allowance(ctx,'conflicts',1,now)&&![...sql.exec('SELECT event_id FROM public_coordination_events WHERE event_id=?',p.id)].length){
      await admitMutation(()=>{
        // Alarm admission yields; another importer may have recovered this
        // exact occurrence while its durable wake was being acknowledged.
        if(!allowance(ctx,'conflicts',1,now)||[...sql.exec('SELECT event_id FROM public_coordination_events WHERE event_id=?',p.id)].length)return;
        charge(ctx,'conflicts',1,now);
        sharedStore(ctx,'/internal/shared/coordination',legacyUpdate(p,commentId));
      });
    }
  }
  const prior=hintReceipt(ctx,commentId);if(prior)return prior;
  sql.exec('CREATE TABLE IF NOT EXISTS public_import_hints (comment_id INTEGER PRIMARY KEY,status INTEGER NOT NULL,expires_ms INTEGER NOT NULL)');
  sql.exec('DELETE FROM public_import_hints WHERE expires_ms<=?',now);
  const cached=[...sql.exec('SELECT * FROM public_import_hints WHERE comment_id=?',commentId)][0];
  if(cached)return Response.json({commentId,status:cached.status===202?'fetching':'retry-later',retryAt:new Date(cached.expires_ms).toISOString()},
    {status:cached.status,headers:{'Retry-After':String(Math.max(1,Math.ceil((cached.expires_ms-now)/1000)))}});
  if([...sql.exec('SELECT COUNT(*) AS n FROM public_import_hints')][0].n>=128)return Response.json({error:'Hint cache busy; use the existing reconciler'},{status:429});
  const permit=takePublicationFetch(ctx,'hint',now);
  if(!permit.ok)return Response.json({error:'Import hint rate limited; the existing reconciler is retained',reason:permit.reason,retryAt:new Date(permit.retryAt).toISOString()},
    {status:429,headers:{'Retry-After':String(Math.max(1,Math.ceil((permit.retryAt-now)/1000)))}});
  // Durable short reservation suppresses concurrent retries and bounds egress
  // after a process loss. No caller URLs, headers, secrets or identities survive.
  sql.exec('INSERT INTO public_import_hints VALUES(?,202,?)',commentId,now+10000);
  try {
    const response=await fetcher(COMMENT_URL+commentId,{headers:GITHUB_HEADERS,redirect:'manual',signal:AbortSignal.timeout(3500)});
    publicationBackoff(ctx,response,now);
    if(!response.ok){
      const status=[403,429].includes(response.status)?429:response.status===404?422:503;
      sql.exec('UPDATE public_import_hints SET status=?,expires_ms=? WHERE comment_id=?',status,now+INTERVAL,commentId);
      return Response.json({error:'GitHub comment could not be validated; use the existing reconciler'},{status});
    }
    const comment=await boundedJson(response,131072);
    // The GET path selects a repository, not an issue. Check independently
    // returned issue_url and numeric ID before trusting owner/schema decoding.
    const publication=comment?.id===commentId&&comment.issue_url===ISSUE_URL?decodePublication(comment):null;
    if(!publication){sql.exec('UPDATE public_import_hints SET status=422,expires_ms=? WHERE comment_id=?',now+INTERVAL,commentId);
      return Response.json({error:'Comment is not a valid publication in the fixed issue'},{status:422});}
    const raced=hintReceipt(ctx,commentId);
    if(raced){sql.exec('DELETE FROM public_import_hints WHERE comment_id=?',commentId);return raced;}
    // Only independently validated durable publication work requires mutation
    // admission. Receipt/cache/budget no-ops never reserve an alarm wake.
    return await admitMutation(async()=>{
      sql.exec('INSERT OR IGNORE INTO imported_comments(comment_id,publication,imported) VALUES(?,?,?)',commentId,JSON.stringify(publication),pendingDisposition(publication));
      await applyPendingPublications(ctx,{now,commentId,work:{pending:100,conflicts:0},recover:false});
      sql.exec('DELETE FROM public_import_hints WHERE comment_id=?',commentId);
      return hintReceipt(ctx,commentId);
    });
  } catch {
    sql.exec('UPDATE public_import_hints SET status=503,expires_ms=? WHERE comment_id=?',now+INTERVAL,commentId);
    return Response.json({error:'Import hint unavailable; the existing reconciler is retained'},{status:503});
  }
}
