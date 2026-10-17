// Local workerd fixture only. This module is never an application entrypoint.
import {Hub} from '../../backend/worker.js';
import {publicationSchema, importPublicationHint} from '../../backend/publications.js';
import {relayOAuthStore} from '../../backend/relay-oauth.js';
import {relayEventSchema, scheduleRelayAlarm, drainRelayOutbox, relayOwnerDelivery} from '../../backend/relay-events.js';

const fixtureId=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
export class ReadCostFixture extends Hub {
  constructor(ctx,env){
    super(ctx,env);
    this.cursors=[];
    const sql={exec:(query,...values)=>{
      const cursor=ctx.storage.sql.exec(query,...values);
      this.cursors.push({query,cursor});return cursor;
    }};
    const storage=new Proxy(ctx.storage,{get:(target,key)=>{
      if(key==='sql')return sql;
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
    this.ctx=new Proxy(ctx,{get:(target,key)=>{
      if(key==='storage')return storage;
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
  }
  async alarm(){} // Measurements never run timer loops or callback transport.
  seed(count){
    this.now=Date.now();this.count=count;
    publicationSchema(this.ctx);relayEventSchema(this.ctx);
    relayOAuthStore(this.ctx,{op:'get',key:'fictional-missing'},this.now);
    const sql=this.ctx.storage.sql;
    sql.exec('CREATE TABLE fixture_numbers(n INTEGER PRIMARY KEY)');
    sql.exec('INSERT INTO fixture_numbers WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM numbers WHERE n<?) SELECT n FROM numbers',count);
    sql.exec("INSERT INTO shared_entries(id,kind,body,created_at) SELECT printf('00000000-0000-4000-8000-%012d',n),'user','Fictional request','2026-10-08T00:00:00Z' FROM fixture_numbers");
    sql.exec("INSERT OR IGNORE INTO public_changes(kind,item_id,request_id) SELECT 'entry',id,id FROM shared_entries");
    sql.exec("INSERT INTO imported_comments(comment_id,publication,imported) SELECT n,'{\"type\":\"briefing\",\"body\":\"Fictional processed comment\"}',1 FROM fixture_numbers");
    sql.exec("INSERT INTO relay_oauth SELECT 'fixture:'||n,'diagnostic','{}',? FROM fixture_numbers",this.now+86400000);
    sql.exec("INSERT INTO relay_events(event_id,message_id,occurred_at,created_ms,data) SELECT 'fixture-event-'||n,'owner:'||printf('00000000-0000-4000-8000-%012d',n),'2026-10-08T00:00:00Z',?,'{}' FROM fixture_numbers",this.now);
    sql.exec('INSERT INTO relay_subscriptions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)','fictional-sub','fictional-principal','fictional-grant','relay.owner.message.created','{}','https://callback.example.test','fictional-local-secret',null,null,this.now+86400000,0,0,'fictional-generation','active');
    sql.exec("INSERT INTO relay_outbox(subscription_id,event_seq,body,status,next_attempt_ms) SELECT 'fictional-sub',n,'{}','delivered',? FROM fixture_numbers",this.now);
    sql.exec("UPDATE relay_outbox SET status='pending',attempts=5,next_attempt_ms=? WHERE event_seq=?",this.now+16000,count-1);
    sql.exec("UPDATE relay_outbox SET status='pending' WHERE event_seq=?",count);
    for(const [key,value] of Object.entries({'publication-imported':true,'publisher-next-attempt':this.now+300000,'publisher-status':{ok:true,pending:0,conflicts:0},
      'publisher-egress-budget':{hour:Math.floor(this.now/3600000),minute:Math.floor(this.now/60000),total:48,hints:12,burst:2}}))
      sql.exec('INSERT OR REPLACE INTO shared_meta VALUES(?,?)',key,JSON.stringify(value));
  }
  async fetch(request){
    const path=new URL(request.url).pathname;
    if(path==='/seed'){
      const count=Number(new URL(request.url).searchParams.get('count')||5000);
      this.seed(count);return Response.json({seeded:count});
    }
    if(path==='/plans'){
      const queries={
        pending:['SELECT * FROM imported_comments WHERE imported=0 AND comment_id>? ORDER BY comment_id LIMIT 500',[0]],
        pendingCount:['SELECT COUNT(*) AS n FROM imported_comments WHERE imported=0',[]],
        registryExpiry:['DELETE FROM relay_oauth WHERE expires_at<=?',[this.now]],
        registryClient:["UPDATE relay_oauth SET expires_at=? WHERE category='client' AND expires_at>? AND expires_at<?",[Number.MAX_SAFE_INTEGER,this.now,Number.MAX_SAFE_INTEGER]],
        delivery:['SELECT subscription_id FROM relay_outbox WHERE event_seq=?',[2500]],
        unsettled:["SELECT event_seq FROM relay_outbox INDEXED BY relay_outbox_unsettled WHERE subscription_id=? AND status IN ('pending','failed') ORDER BY event_seq LIMIT 1",['fictional-sub']]
      };
      return Response.json(Object.fromEntries(Object.entries(queries).map(([name,[query,values]])=>[name,[...this.ctx.storage.sql.exec('EXPLAIN QUERY PLAN '+query,...values)].map(row=>row.detail)])));
    }
    if(path==='/scheduler'){
      this.now=Date.now();
      this.ctx.storage.sql.exec('UPDATE relay_outbox SET next_attempt_ms=? WHERE event_seq=?',this.now+16000,this.count-1);
      this.ctx.storage.sql.exec('UPDATE relay_outbox SET next_attempt_ms=? WHERE event_seq=?',this.now,this.count);
    }
    // Discard seed/migration cost; these are warmed steady-state measurements.
    this.cursors=[];let status=200,result;
    if(path==='/state'){
      const response=await super.fetch(new Request('https://internal/internal/shared/state?after=2000'));
      status=response.status;const data=await response.json();result={messages:data.messages.length,nextCursor:data.nextCursor};
    }else if(path==='/hint'){
      const response=await importPublicationHint(this.ctx,{commentId:900001},()=>{throw Error('No local fixture egress');},this.now);
      status=response.status;result=await response.json();
    }else if(path==='/registry'){
      result=await relayOAuthStore(this.ctx,{op:'get',key:'fictional-missing'},this.now).json();
    }else if(path==='/scheduler'){
      await scheduleRelayAlarm(this.ctx,this.now);result={delayMs:(await this.ctx.storage.getAlarm())-this.now};
    }else if(path==='/delivery'){
      result=relayOwnerDelivery(this.ctx,{},fixtureId(2500),false,this.now);
    }else if(path==='/retention'){
      // Isolate retained-journal housekeeping from subscription/auth cleanup.
      this.ctx.storage.sql.exec('DELETE FROM relay_subscriptions');this.ctx.storage.sql.exec('DELETE FROM relay_outbox');this.cursors=[];
      await drainRelayOutbox(this.ctx,{},null,this.now);
      // The verification count itself is not housekeeping work being measured.
      result={eventsKept:[...this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM relay_events')][0].n};this.cursors.pop();
    }else return new Response('Unknown local case',{status:404});
    const queries=this.cursors.map(({query,cursor})=>({query:query.replace(/\s+/g,' ').trim(),rowsRead:cursor.rowsRead,rowsWritten:cursor.rowsWritten}));
    return Response.json({status,result,rowsRead:queries.reduce((n,q)=>n+q.rowsRead,0),queries});
  }
}
export default {fetch(request,env){return env.HUBS.get(env.HUBS.idFromName('local-cost-fixture')).fetch(request);}};
