// Local workerd cost fixture only. No application entrypoint or live transport.
import {sharedSchema,sharedStore,validateSharedRead,readLegacyInboxPage} from '../../backend/shared.js';
import {publicationSchema,syncPublications,nextPublicationReconciliationAt} from '../../backend/publications.js';
import {relayOwnerSchema} from '../../backend/relay-owner.js';
import {relayEventSchema} from '../../backend/relay-events.js';

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const stamp='2026-10-08T00:00:00Z';
export class CorePublicCostFixture {
  constructor(ctx){
    this.raw=ctx;this.cursors=[];this.egress=0;this.legacyReads=0;
    const sql={exec:(query,...values)=>{const cursor=ctx.storage.sql.exec(query,...values);this.cursors.push({query,cursor});return cursor;}};
    const storage=new Proxy(ctx.storage,{get:(target,key)=>{if(key==='sql')return sql;
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
    this.ctx=new Proxy(ctx,{get:(target,key)=>{if(key==='storage')return storage;
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
    this.legacyContext={storage:{get:()=>{this.legacyReads++;return ctx.storage.get('fictional-legacy-state');}}};
    this.env={HUBS:{idFromName:name=>name,get:()=>({fetch:request=>readLegacyInboxPage(this.legacyContext,new URL(request.url).searchParams)})}};
  }
  async alarm(){} // Alarm ordering/composition is verified by the separate host fixture.
  meta(key){return JSON.parse([...this.ctx.storage.sql.exec('SELECT value FROM shared_meta WHERE key=?',key)][0]?.value||'null');}
  async seed(mode,count){
    this.now=Date.now();this.mode=mode;
    if(mode==='private'){relayOwnerSchema(this.ctx);relayEventSchema(this.ctx);return;}
    const sql=this.ctx.storage.sql;
    if(mode==='cold'){
      sql.exec(`CREATE TABLE shared_entries(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,
        reply_to TEXT UNIQUE,title TEXT,body TEXT NOT NULL,created_at TEXT NOT NULL)`);
      sql.exec('CREATE INDEX shared_kind_seq ON shared_entries(kind,seq)');
      sql.exec('CREATE TABLE shared_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    }else sharedSchema(this.ctx);
    sql.exec('CREATE TABLE fixture_numbers(n INTEGER PRIMARY KEY)');
    sql.exec('INSERT INTO fixture_numbers WITH RECURSIVE nums(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM nums WHERE n<?) SELECT n FROM nums',count);
    sql.exec("INSERT INTO shared_entries(id,kind,body,created_at) SELECT printf('00000000-0000-4000-8000-%012d',n),'user','Fictional public request',? FROM fixture_numbers",stamp);
    publicationSchema(this.ctx);
    if(mode!=='cold')sql.exec("INSERT OR IGNORE INTO public_changes(kind,item_id,request_id) SELECT 'entry',id,id FROM shared_entries");
    if(mode==='warm'){
      sql.exec("INSERT INTO imported_comments(comment_id,publication,imported) SELECT n,'{}',1 FROM fixture_numbers");
      await syncPublications(this.ctx,()=>{this.egress++;return Response.json([]);},this.now);
    }
    if(mode==='pending')sql.exec(`INSERT INTO imported_comments(comment_id,publication,imported) SELECT n,json_object('type','coordination','payload',
      json_object('schema','jarvis-coordination-v2','eventId',printf('00000000-0000-4000-8000-%012d',n+10000),
      'requestId',printf('00000000-0000-4000-8000-%012d',n+20000),'attemptId',printf('00000000-0000-4000-8000-%012d',n+30000),
      'stage','final','body','Fictional missing-original result','artifacts',json('[]'),'resultVersion',1),
      'provenance',json_object('source','github-issue','repository','braydenparker999/jarvis','issue',2,'commentId',n,
      'authorId',183016859,'publishedAt',?)),-1 FROM fixture_numbers`,stamp);
    if(mode==='legacy'){
      const messages=Array.from({length:251},(_,n)=>({id:id(n+10000),role:n%2?'assistant':'user',
        body:n%2?'Fictional untrusted receipt':'Fictional late old public request',createdAt:stamp}));
      const legacy={messages,posts:[]};this.legacyBytes=new TextEncoder().encode(JSON.stringify(legacy)).length;
      await this.raw.storage.put('fictional-legacy-state',legacy);
    }
  }
  async fetch(request){
    const url=new URL(request.url),mode=url.searchParams.get('mode')||'warm';
    if(url.pathname==='/seed'){await this.seed(mode,Number(url.searchParams.get('count')||5000));return Response.json({ok:true});}
    this.cursors=[];this.egress=0;this.legacyReads=0;let result;
    const fetcher=()=>{this.egress++;return Response.json([]);};
    if(url.pathname==='/private-next'){
      const next=nextPublicationReconciliationAt(this.ctx,this.now);result={status:200,next};
    }else if(url.pathname==='/warm-state'||url.pathname==='/warm-changes'){
      const path=url.pathname.endsWith('state')?'/internal/shared/state':'/internal/shared/changes';
      const params=new URLSearchParams(path.endsWith('state')?{after:'2000'}:{cursor:'pc2:2000'});
      const validation=validateSharedRead(this.ctx,path,params);if(validation)throw Error('Fictional read invalid');
      await syncPublications(this.ctx,fetcher,this.now+1);
      const response=sharedStore(this.ctx,path,{},params),data=await response.json();
      result={status:response.status,count:data.messages?.length??data.changes?.length,nextCursor:data.nextCursor};
    }else if(url.pathname==='/pass'){
      await syncPublications(this.ctx,fetcher,this.now,this.mode==='legacy'?this.env:null);
      const measured=this.cursors.length;
      result={status:200,indexed:[...this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM public_changes')][0].n,
        nextDelay:nextPublicationReconciliationAt(this.ctx,this.now)-this.now,
        work:{backfill:this.meta('publisher-work:backfill'),pending:this.meta('publisher-work:pending')},
        legacyAfter:this.meta('legacy-inbox-checkpoint')?.after??null};
      // Result verification queries are outside the measured application pass.
      this.cursors.length=measured;
    }else if(url.pathname==='/idle'){
      const due=nextPublicationReconciliationAt(this.ctx,this.now);
      await syncPublications(this.ctx,fetcher,due);
      result={status:200,nextDelay:nextPublicationReconciliationAt(this.ctx,due)-due};
    }else return new Response('Unknown local case',{status:404});
    const queries=this.cursors.map(({query,cursor})=>({query:query.replace(/\s+/g,' ').trim(),rowsRead:cursor.rowsRead,rowsWritten:cursor.rowsWritten}));
    return Response.json({result,rowsRead:queries.reduce((n,q)=>n+q.rowsRead,0),rowsWritten:queries.reduce((n,q)=>n+q.rowsWritten,0),
      egress:this.egress,legacyFullKVReads:this.legacyReads,legacyFullKVBytes:this.legacyReads*(this.legacyBytes||0),queries});
  }
}
export default {fetch(request,env){const mode=new URL(request.url).searchParams.get('mode')||'warm';
  return env.HUBS.get(env.HUBS.idFromName('fictional-core-cost-'+mode)).fetch(request);}};
