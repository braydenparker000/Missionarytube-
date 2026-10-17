// Fictional control routes only. Both immutable c4 and candidate operate on the
// same native SQLite Durable Object; neither source is translated or patched.
import {Hub} from '../../backend/worker.js';
import {sharedSchema,sharedStore} from '../../backend/shared.js';
import {backfillPublicChanges,publicChangesReady} from '../../backend/public-coordination.js';
import {syncPublications,publicationSchema,publicationRollbackCompatible,decodePublication,importPublicationHint,applyPendingPublications,seedPublicationReconciliation,COMMENTS_URL} from '../../backend/publications.js';
import {sharedStore as oldSharedStore} from 'c4:backend/shared.js';
import {syncPublications as oldSyncPublications} from 'c4:backend/publications.js';

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const stamp='2026-10-01T12:00:00.000Z';
export class RollbackRecoveryHub extends Hub {
  constructor(raw){
    const tracker={queries:[],failKey:null};
    const sql={exec(query,...values){
      if(tracker.failKey&&query==='INSERT OR REPLACE INTO shared_meta VALUES(?,?)'&&values[0]===tracker.failKey){
        tracker.failKey=null;throw Error('Fictional interrupted checkpoint commit');
      }
      const cursor=raw.storage.sql.exec(query,...values);tracker.queries.push({query,cursor});return cursor;
    }};
    const storage=new Proxy(raw.storage,{get(target,key){if(key==='sql')return sql;
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
    const ctx=new Proxy(raw,{get(target,key){if(key==='storage')return storage;
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
    super(ctx,{},{});this.raw=raw;this.tracker=tracker;this.calls=0;this.comments=[];this.requested=[];this.failure=null;
    this.publicationFetcher=async(input,init={})=>{
      const url=new URL(input);if(url.origin+url.pathname!==COMMENTS_URL||(init.method||'GET')!=='GET')throw Error('Unexpected fictional publication request');
      this.calls++;const page=Number(url.searchParams.get('page')||1);this.requested.push({page,since:url.searchParams.get('since')});
      if(this.failure?.page===page){
        if(this.failure.kind==='http429')return Response.json({},{status:429,headers:{'Retry-After':'900'}});
        return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('['));controller.error(Error('Fictional interrupted comment response'));}}));
      }
      const history=await this.raw.storage.get('fictional-comment-history');
      // Match the real API: filter by updated_at strictly after since BEFORE
      // pagination. Persisted history is never reposted during candidate resume.
      const cutoff=url.searchParams.has('since')?Date.parse(url.searchParams.get('since')):-Infinity;
      const comments=(history??this.comments).filter(comment=>Date.parse(comment.updated_at)>cutoff).sort((a,b)=>a.id-b.id);
      return Response.json(comments.slice((page-1)*100,page*100));
    };
  }
  async alarm(){} // Explicit /case alarm drives the original Hub.alarm below.
  rows(query,...values){return [...this.ctx.storage.sql.exec(query,...values)];}
  meta(key){return JSON.parse(this.rows('SELECT value FROM shared_meta WHERE key=?',key)[0]?.value||'null');}
  put(key,value){this.ctx.storage.sql.exec('INSERT OR REPLACE INTO shared_meta VALUES(?,?)',key,JSON.stringify(value));}
  async fetch(request){
    const url=new URL(request.url);
    const saved=await this.raw.storage.get('fictional-clock');
    Date.now=()=>saved??Date.parse('2099-10-09T12:00:00.000Z');
    if(url.pathname!=='/case')return super.fetch(request);
    const input=await request.json();
    if(input.now!==undefined){await this.raw.storage.put('fictional-clock',input.now);Date.now=()=>input.now;}
    this.tracker.queries=[];this.calls=0;this.comments=input.comments||[];this.requested=[];this.failure=input.failure||null;let response;
    if(input.failKey&&input.op!=='schema')this.tracker.failKey=input.failKey;
    if(input.op==='store')response=(input.old?oldSharedStore:sharedStore)(this.ctx,input.path,input.body||{},new URLSearchParams(input.params||{}));
    else if(input.op==='sync'){
      await (input.old?oldSyncPublications:syncPublications)(this.ctx,this.publicationFetcher,Date.now());response=Response.json({ok:true});
    }else if(input.op==='hint')response=await importPublicationHint(this.ctx,{commentId:input.commentId},()=>{throw Error('Durable hint cannot fetch');},Date.now());
    else if(input.op==='alarm'){await super.alarm();response=Response.json({ok:true});}
    else if(input.op==='backfill'){response=Response.json(backfillPublicChanges(this.ctx,input.limit??100));}
    else if(input.op==='schema'){
      this.tracker.failKey=input.failKey||null;let error=null;
      try{sharedSchema(this.ctx);}catch(failure){error=failure.message;}response=Response.json({error});
    }else if(input.op==='seed-unsafe'){
      // Genuine old schema + journal layout, with the exact unsafe ccf pending
      // representation. No candidate initializer can predeclare it compatible.
      oldSharedStore(this.ctx,'/internal/shared/state');
      this.ctx.storage.sql.exec('CREATE TABLE imported_comments(comment_id INTEGER PRIMARY KEY,publication TEXT NOT NULL,imported INTEGER NOT NULL DEFAULT 0,error TEXT)');
      this.ctx.storage.transactionSync(()=>{
        for(let n=1;n<=input.count;n++){
          const payload={schema:'jarvis-coordination-v2',eventId:id(n+10000),requestId:id(n+20000),attemptId:id(n+30000),stage:'final',body:'Fictional missing dependency',resultVersion:1,artifacts:[]};
          const p=decodePublication({id:n,user:{id:183016859},created_at:stamp,body:JSON.stringify(payload)});
          this.ctx.storage.sql.exec('INSERT INTO imported_comments(comment_id,publication) VALUES(?,?)',n,JSON.stringify(p));
        }
      });response=Response.json({ok:true});
    }else if(input.op==='prepare-unsafe'){
      publicationSchema(this.ctx);response=Response.json({ok:true});
    }else if(input.op==='seed-reconciliation'){
      seedPublicationReconciliation(this.ctx,Date.now());response=Response.json({ok:true});
    }else if(input.op==='seed-mixed'){
      publicationSchema(this.ctx);
      this.ctx.storage.transactionSync(()=>{
        for(let n=1;n<=input.count;n++){
          const payload=n%2?{schema:'jarvis-coordination-v2',eventId:id(n+10000),requestId:id(n+20000),attemptId:id(n+30000),stage:'final',body:'Fictional missing dependency',resultVersion:1,artifacts:[]}:
            {schema:'jarvis-publication-v1',id:id(n+10000),replyTo:id(n+20000),type:'reply',body:'Fictional missing legacy original'};
          const p=decodePublication({id:n,user:{id:183016859},created_at:stamp,body:JSON.stringify(payload)});
          this.ctx.storage.sql.exec('INSERT INTO imported_comments(comment_id,publication,imported) VALUES(?,?,?)',n,JSON.stringify(p),n%2?-1:0);
        }
        this.ctx.storage.sql.exec("INSERT INTO imported_comments(comment_id,publication,imported) VALUES(?,'{}',-2)",input.count+1);
      });response=Response.json({ok:true});
    }else if(input.op==='pending-batch'){
      const result=await applyPendingPublications(this.ctx,{now:Date.now(),work:{pending:100,conflicts:0},recover:false});
      response=Response.json({...result,cursor:this.meta('publisher-pending-cursor')});
    }else if(input.op==='interrupt-compatibility'){
      this.tracker.failKey='publisher-v2-pending-compatibility';
      await syncPublications(this.ctx,this.publicationFetcher,Date.now());response=Response.json({ok:true});
    }else if(input.op==='remove-index-version'){
      this.ctx.storage.transactionSync(()=>{
        this.ctx.storage.sql.exec('DROP TRIGGER public_changes_entry_insert');
        this.ctx.storage.sql.exec("DELETE FROM shared_meta WHERE key='public-entry-index-version'");
      });response=Response.json({ok:true});
    }else if(input.op==='old-partial-index'){
      // Exact original entry-index prefix/checkpoint shape retained by ccf.
      this.ctx.storage.transactionSync(()=>{
        this.ctx.storage.sql.exec("INSERT OR IGNORE INTO public_changes(kind,item_id,request_id) SELECT 'entry',id,CASE WHEN kind='user' THEN id ELSE reply_to END FROM shared_entries WHERE seq<=? ORDER BY seq",input.after);
        this.put('public-changes-backfilled',false);this.put('public-artifacts-backfilled',false);
        this.put('public-changes-backfill',{entryAfter:input.after,eventAfter:0,throughEntry:input.through,throughEvent:0});
      });response=Response.json({ok:true});
    }else if(input.op==='interrupt-backfill'){
      this.tracker.failKey='public-changes-backfill';let error=null;
      try{backfillPublicChanges(this.ctx,100);}catch(failure){error=failure.message;}
      response=Response.json({error});
    }else if(input.op==='old-burst'){
      this.ctx.storage.transactionSync(()=>{
        for(let n=0;n<input.count;n++){
          // Exercise actual old writes over several history pages while keeping
          // its unchanged 200-user/day gate: 180 users, then their real replies.
          const reply=n>=180;
          const result=oldSharedStore(this.ctx,'/internal/shared/'+(reply?'reply':'message'),{id:id(input.start+n),
            ...(reply?{replyTo:id(input.start+n-180)}:{}),body:'Fictional old append '+n,createdAt:stamp});
          if(!result.ok)throw Error('Fictional old append rejected');
        }
      });response=Response.json({ok:true});
    }else if(input.op==='append-history'){
      const history=await this.raw.storage.get('fictional-comment-history')||[];
      for(const comment of input.comments){if(history.some(prior=>prior.id===comment.id))throw Error('Fictional history cannot repost an existing comment');history.push(comment);}
      await this.raw.storage.put('fictional-comment-history',history);response=Response.json({count:history.length});
    }else if(input.op==='snapshot'){
      const measured=this.tracker.queries.length;
      const tables=this.rows("SELECT name FROM sqlite_master WHERE type='table'").map(row=>row.name);
      const has=name=>tables.includes(name);
      const result={entries:has('shared_entries')?this.rows('SELECT * FROM shared_entries ORDER BY seq'):[],
        changes:has('public_changes')?this.rows('SELECT * FROM public_changes ORDER BY seq'):[],
        imported:has('imported_comments')?this.rows('SELECT comment_id,imported,error FROM imported_comments ORDER BY comment_id'):[],
        events:has('public_coordination_events')?this.rows('SELECT * FROM public_coordination_events ORDER BY seq'):[],
        artifacts:has('public_artifact_state')?this.rows('SELECT * FROM public_artifact_state ORDER BY request_id,attempt_id,artifact_id'):[],
        triggers:this.rows("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").map(row=>row.name),
        checkpoint:has('shared_meta')?this.meta('public-changes-backfill'):null,
        compatibility:has('shared_meta')?this.meta('publisher-v2-pending-compatibility'):null,
        publisher:has('shared_meta')?this.meta('publisher-status'):null,
        since:has('shared_meta')?this.meta('publisher-since'):null,scan:has('shared_meta')?this.meta('publisher-scan'):null,
        coverage:has('shared_meta')?this.meta('publisher-v2-coverage'):null,
        upstreamNotBefore:has('shared_meta')?this.meta('publisher-upstream-not-before'):null,
        pendingWork:has('shared_meta')?this.meta('publisher-work:pending'):null,
        ready:has('public_changes')?publicChangesReady(this.ctx):false,
        rollbackCompatible:has('shared_meta')?publicationRollbackCompatible(this.ctx):false};
      this.tracker.queries.length=measured;response=Response.json(result);
    }else if(input.op==='pending-plan'){
      response=Response.json([0,-1].map(disposition=>({disposition,plan:this.rows('EXPLAIN QUERY PLAN SELECT * FROM imported_comments WHERE imported=? AND comment_id>? ORDER BY comment_id LIMIT ?',disposition,0,100),
        ids:this.rows('SELECT comment_id FROM imported_comments WHERE imported=? AND comment_id>? ORDER BY comment_id LIMIT ?',disposition,0,100).map(row=>row.comment_id)})));
    }else return new Response('Unknown fictional control',{status:404});
    const body=await response.json();const queries=this.tracker.queries.map(({query,cursor})=>({query,rowsRead:cursor.rowsRead,rowsWritten:cursor.rowsWritten}));
    return Response.json({status:response.status,body,calls:this.calls,requested:this.requested,queries,
      rowsRead:queries.reduce((sum,item)=>sum+item.rowsRead,0),rowsWritten:queries.reduce((sum,item)=>sum+item.rowsWritten,0)});
  }
}
export default{fetch(request,env){return env.HUBS.get(env.HUBS.idFromName('fictional-rollback-'+(new URL(request.url).searchParams.get('actor')||'main'))).fetch(request);}};
