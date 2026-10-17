// Closed local SQLite fixture; never part of the application bundle.
import {Hub} from '../../backend/worker.js';
import {relayOwnerSchema} from '../../backend/relay-owner.js';
import {relayOwnerJobsList,relayOwnerJobsChanges} from '../../backend/relay-owner-jobs.js';

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
export class OwnerWorkCostFixture extends Hub {
  constructor(ctx,env){
    super(ctx,env);this.cursors=[];
    const sql={exec:(query,...values)=>{const cursor=ctx.storage.sql.exec(query,...values);this.cursors.push({query,cursor});return cursor;}};
    const storage=new Proxy(ctx.storage,{get:(target,key)=>{if(key==='sql')return sql;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
    this.ctx=new Proxy(ctx,{get:(target,key)=>{if(key==='storage')return storage;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  }
  async alarm(){}
  async fetch(request){
    const path=new URL(request.url).pathname,sql=this.ctx.storage.sql;
    if(path==='/seed'){
      this.now=Date.now();relayOwnerSchema(this.ctx);
      sql.exec('CREATE TABLE fixture_numbers(n INTEGER PRIMARY KEY)');sql.exec('INSERT INTO fixture_numbers WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM numbers WHERE n<5000) SELECT n FROM numbers');
      sql.exec("INSERT INTO relay_owner_entries(id,kind,body,created_at,principal,device_id,authentication_source) SELECT printf('00000000-0000-4000-8000-%012d',n),'user','Fictional private work','2026-10-09T00:00:00Z','github:183016859','00000000-0000-4000-8000-999999999999','owner-device-session' FROM fixture_numbers");
      sql.exec(`INSERT INTO relay_owner_jobs(seq,id,request_id,principal,device_id,title,action_kind,specified,stage,created_ms,updated_ms,root_job_id,attempt,outcome)
        SELECT seq,id,id,principal,device_id,'Fictional task','read_only',1,'queued',?,?,id,1,'unknown' FROM relay_owner_entries`,this.now,this.now);
      sql.exec(`INSERT INTO relay_owner_job_events(id,job_id,kind,summary,created_ms,authentication_source,argument_json,writer_id)
        SELECT 'specified:'||id,id,'specified','Owner supplied fictional labels.',?,'owner-device-session','{"organization":{"projectTitle":"Fictional project","goalTitle":"Fictional goal"}}',device_id FROM relay_owner_entries`,this.now);
      sql.exec(`INSERT INTO relay_owner_job_events(id,job_id,kind,summary,created_ms,authentication_source,argument_json,writer_id)
        SELECT printf('10000000-0000-4000-8000-%012d',n),printf('00000000-0000-4000-8000-%012d',n),'running','Fictional meaningful progress.',?,'owner-oauth-mcp','{}','fictional-grant' FROM fixture_numbers`,this.now);
      // A deliberately worst-case bounded tail of generic heartbeats. Their
      // sparse update lookup cannot scan any other job's 5,000 retained events.
      sql.exec(`INSERT INTO relay_owner_job_events(id,job_id,kind,summary,created_ms,authentication_source,argument_json,writer_id)
        SELECT printf('20000000-0000-4000-8000-%012d',n),?,'running','Authenticated execution progress acknowledged.',?,'owner-oauth-mcp','{}','fictional-grant' FROM fixture_numbers WHERE n<=99`,id(2500),this.now);
      // Finish the existing read-repair bootstrap, rather than measuring a cold
      // migration as steady-state work. Seed/index construction is not free.
      let cursor='0';for(let n=0;n<200;n++){const page=relayOwnerJobsChanges(this.ctx,this.env,cursor,50,null,this.now);cursor=page.cursor;if(page.nextCursor===null&&!page.bootstrapPending)break;}
      this.cursor=cursor;this.cursors=[];return Response.json({seededJobs:5000,heartbeatTail:99,cursor});
    }
    if(path==='/plans')return Response.json({plans:[...sql.exec("EXPLAIN QUERY PLAN SELECT id,kind,summary,created_ms FROM relay_owner_job_events WHERE job_id=? AND authentication_source='owner-oauth-mcp' AND writer_id!='accepted-owner-reply' AND kind IN ('claimed','running','waiting_for_owner','failed','cancelled','work_completed','result_corrected') AND NOT(kind='running' AND summary='Authenticated execution progress acknowledged.') ORDER BY seq DESC LIMIT 1",id(2500))].map(r=>r.detail)});
    this.cursors=[];
    const include=path==='/presentation',after=new URL(request.url).searchParams.get('after')||'2499',result=path==='/idle'?relayOwnerJobsChanges(this.ctx,this.env,this.cursor,50,null,this.now,true):relayOwnerJobsList(this.ctx,this.env,after,1,this.now,include);
    const queries=this.cursors.map(({query,cursor})=>({query:query.replace(/\s+/g,' ').trim(),rowsRead:cursor.rowsRead}));
    return Response.json({rowsRead:queries.reduce((sum,q)=>sum+q.rowsRead,0),queries,jobs:result.jobs?.length??result.changes.length,latestSummary:result.jobs?.[0]?.presentation?.latestUpdate?.summary??null});
  }
}
export default {fetch(request,env){return env.HUBS.get(env.HUBS.idFromName('fictional-cost')).fetch(request);}};
