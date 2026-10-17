import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

// Local-only Worker: native workerd cursor metrics, fictional event/grant/
// subscription/callback data and a future fixture clock; no live host work.
const fixtureSource=`
import {sharedSchema} from '../backend/shared.js';
import {relayOAuthStore} from '../backend/relay-oauth.js';
import {relayEventSchema,relaySubscribe,drainRelayOutbox,relayNextAlarmTime,scheduleRelayAlarm,enqueueRelayOwnerMessage} from '../backend/relay-events.js';
import {RELAY_OWNER,RELAY_OWNER_SCOPE,RELAY_OWNER_INBOX,RELAY_OWNER_EVENT,RELAY_INBOX} from '../backend/relay-common.js';
export class EventCostFixture {
  constructor(ctx,env){
    this.env={...env,RELAY_MCP_ENABLED:'true',RELAY_OWNER_ENABLED:'true',RELAY_MCP_ORIGIN:'https://fictional.example.test'};
    this.cursors=[];this.alarmWrites=0;
    const sql={exec:(query,...values)=>{const cursor=ctx.storage.sql.exec(query,...values);this.cursors.push({query,cursor});return cursor;}};
    const storage=new Proxy(ctx.storage,{get:(target,key)=>{
      if(key==='sql')return sql;
      if(key==='setAlarm')return async value=>{this.alarmWrites++;return target.setAlarm(value);};
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
    this.ctx=new Proxy(ctx,{get:(target,key)=>{if(key==='storage')return storage;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  }
  async alarm(){} // Measurements never run an autonomous callback timer loop.
  seed(count,mode,legacy){
    this.now=Date.now()+600000;this.mode=mode;this.count=count;
    sharedSchema(this.ctx);relayEventSchema(this.ctx);relayOAuthStore(this.ctx,{op:'get',key:'fictional-missing'},this.now);
    const sql=this.ctx.storage.sql;
    sql.exec('CREATE TABLE fictional_numbers(n INTEGER PRIMARY KEY)');
    sql.exec('INSERT INTO fictional_numbers WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM numbers WHERE n<?) SELECT n FROM numbers',count);
    sql.exec("INSERT INTO relay_events(event_id,message_id,occurred_at,created_ms,data) SELECT 'fictional-event-'||n,CASE WHEN ?='cross' AND n<? THEN 'public:' ELSE 'owner:' END||printf('00000000-0000-4000-8000-%012d',n),'2026-10-09T00:00:00Z',?,json_object('inbox_id',CASE WHEN ?='cross' AND n<? THEN ? ELSE ? END,'message_id',printf('00000000-0000-4000-8000-%012d',n),'author_authenticated',CASE WHEN ?='cross' AND n<? THEN json('false') ELSE json('true') END) FROM fictional_numbers",mode,count,this.now,mode,count,RELAY_INBOX,RELAY_OWNER_INBOX,mode,count);
    sql.exec("INSERT INTO relay_owner_event_bodies SELECT 'fictional-event-'||n,CASE WHEN ?='dense' OR (?='flood' AND n=251) OR (?!='flood' AND (n=? OR (?='cross' AND n=?))) THEN 'Fictional needle text' ELSE 'Fictional ignored ASCII text' END FROM fictional_numbers WHERE ?!='cross' OR n=?",mode,mode,mode,count-100,mode,count,mode,count);
    sql.exec('INSERT INTO relay_oauth VALUES(?,?,?,?)','grant:fictional-grant','grant',JSON.stringify({principal:RELAY_OWNER,resource:this.env.RELAY_MCP_ORIGIN+'/relay/mcp',scope:RELAY_OWNER_SCOPE,revoked:false}),this.now+86400000);
    if(legacy)sql.exec('DROP INDEX relay_event_kind_seq');
  }
  async fetch(request){
    const u=new URL(request.url),path=u.pathname;
    if(path==='/seed'){this.seed(Number(u.searchParams.get('count')||6000),u.searchParams.get('mode')||'sparse',u.searchParams.get('legacy')==='1');return Response.json({fictional:true,seeded:this.count});}
    if(path==='/schema-rollback'){
      const sql=this.ctx.storage.sql,rollback=Error('Fictional rolled-back event schema');
      const abort=()=>{try{this.ctx.storage.transactionSync(()=>{relayEventSchema(this.ctx);throw rollback;});}catch(error){if(error!==rollback)throw error;return;}throw Error('Expected fictional rollback');};
      abort();
      const firstAbsent=[...sql.exec("SELECT name FROM sqlite_master WHERE name='relay_events'")].length===0;
      relayEventSchema(this.ctx);sql.exec('DROP INDEX relay_event_kind_seq');sql.exec('DROP TABLE relay_subscription_scans');
      abort();
      const upgradeAbsent=[...sql.exec("SELECT name FROM sqlite_master WHERE name IN ('relay_event_kind_seq','relay_subscription_scans')")].length===0;
      relayEventSchema(this.ctx);this.cursors=[];relayEventSchema(this.ctx);
      const queries=this.cursors.map(({query,cursor})=>({query,rowsRead:cursor.rowsRead,rowsWritten:cursor.rowsWritten}));
      return Response.json({fictional:true,firstAbsent,upgradeAbsent,rowsRead:queries.reduce((n,q)=>n+q.rowsRead,0),rowsWritten:queries.reduce((n,q)=>n+q.rowsWritten,0),queries});
    }
    if(path==='/unicode'){
      this.seed(3,'unicode',false);
      const nulBody='Fictional '+String.fromCharCode(0)+' KELVIN after nul',sql=this.ctx.storage.sql;
      for(const [n,body] of [[1,'Fictional KELVIN message'],[2,'Fictional %_ literal'],[3,nulBody]])sql.exec('UPDATE relay_owner_event_bodies SET body=? WHERE event_id=?',body,'fictional-event-'+n);
      const nativeNulBody=[...sql.exec('SELECT body FROM relay_owner_event_bodies WHERE event_id=?','fictional-event-3')][0].body;
      const acceptedCursors=[],fetcher=async(_url,options)=>{
        const body=JSON.parse(options.body);if(body.type==='verification')return Response.json({challenge:body.challenge});
        acceptedCursors.push(body.cursor);return new Response(null,{status:204});
      };
      const p={name:RELAY_OWNER_EVENT,arguments:{inbox_id:RELAY_OWNER_INBOX,message_contains:'kelvin'},delivery:{mode:'webhook',url:'https://fictional.example.test/callback',secret:'whsec_'+btoa(String.fromCharCode(...new Uint8Array(32).fill(27)))},cursor:'relay1:0'};
      const sub=await relaySubscribe(this.ctx,{principal:RELAY_OWNER,grantId:'fictional-grant',scopes:[RELAY_OWNER_SCOPE]},p,this.env,fetcher,this.now);
      const queuedSeq=[...sql.exec('SELECT event_seq FROM relay_outbox WHERE subscription_id=? ORDER BY event_seq',sub.id)].map(row=>row.event_seq);
      await drainRelayOutbox(this.ctx,this.env,fetcher,this.now,{schedule:false});
      await drainRelayOutbox(this.ctx,this.env,fetcher,this.now+50,{schedule:false});
      const ack=[...sql.exec('SELECT ack_seq FROM relay_subscriptions WHERE id=?',sub.id)][0].ack_seq;
      return Response.json({fictional:true,nativeNulBody,queuedSeq,acceptedCursors,ack});
    }
    if(path==='/plan'){
      const index=[...this.ctx.storage.sql.exec("SELECT sql FROM sqlite_master WHERE name='relay_event_kind_seq'")][0].sql;
      const expression=index.slice(index.indexOf('((')+1,index.lastIndexOf(',seq)'));
      const plan=[...this.ctx.storage.sql.exec('EXPLAIN QUERY PLAN SELECT seq FROM relay_events INDEXED BY relay_event_kind_seq WHERE '+expression+'=? AND seq>? AND seq<=? ORDER BY seq LIMIT ?',RELAY_OWNER_EVENT,0,this.count,250)].map(row=>row.detail);
      return Response.json({plan});
    }
    this.cursors=[];const before=this.alarmWrites;let callbacks=0,next;
    const fetcher=async(_url,options)=>{const body=JSON.parse(options.body);if(body.type==='verification')return Response.json({challenge:body.challenge});callbacks++;return new Response(null,{status:204});};
    if(path==='/cold'){
      const p={name:RELAY_OWNER_EVENT,arguments:{inbox_id:RELAY_OWNER_INBOX,message_contains:'needle'},delivery:{mode:'webhook',url:'https://fictional.example.test/callback',secret:'whsec_'+btoa(String.fromCharCode(...new Uint8Array(32).fill(27)))},cursor:'relay1:0'};
      this.sub=await relaySubscribe(this.ctx,{principal:RELAY_OWNER,grantId:'fictional-grant',scopes:[RELAY_OWNER_SCOPE]},p,this.env,fetcher,this.now);
    }else if(path==='/flood'){
      const count=Number(u.searchParams.get('count')||2200);
      for(let n=1;n<=count;n++)this.ctx.storage.transactionSync(()=>enqueueRelayOwnerMessage(this.ctx,
        {id:'00000000-0000-4000-8000-'+String(n+700000).padStart(12,'0'),body:'Fictional needle live flood '+n,
          createdAt:new Date(this.now).toISOString(),device_id:'00000000-0000-4000-8000-999999999999'},this.now));
      next=relayNextAlarmTime(this.ctx,this.now);
    }else if(path==='/warm'){
      this.now+=50;await drainRelayOutbox(this.ctx,this.env,fetcher,this.now,{schedule:false});
      next=relayNextAlarmTime(this.ctx,this.now);await scheduleRelayAlarm(this.ctx,this.now);
    }else if(path==='/schema-warm'){
      relayEventSchema(this.ctx);
    }else if(path==='/empty'){
      this.ctx.storage.sql.exec('DELETE FROM relay_subscriptions');this.ctx.storage.sql.exec('DELETE FROM relay_outbox');this.cursors=[];
      await drainRelayOutbox(this.ctx,this.env,null,this.now,{schedule:false});next=relayNextAlarmTime(this.ctx,this.now);
    }else return new Response('Unknown local fixture operation',{status:404});
    const queries=this.cursors.map(({query,cursor})=>({query,rowsRead:cursor.rowsRead,rowsWritten:cursor.rowsWritten}));
    const scan=[...this.ctx.storage.sql.exec('SELECT examined_seq FROM relay_subscription_scans WHERE subscription_id=?',this.sub?.id||'fictional-missing')][0];
    const sub=[...this.ctx.storage.sql.exec('SELECT ack_seq FROM relay_subscriptions WHERE id=?',this.sub?.id||'fictional-missing')][0];
    const pending=[...this.ctx.storage.sql.exec("SELECT COUNT(*) AS n FROM relay_outbox WHERE status='pending'")][0].n;
    return Response.json({fictional:true,mode:this.mode,phase:path,rowsRead:queries.reduce((n,q)=>n+q.rowsRead,0),rowsWritten:queries.reduce((n,q)=>n+q.rowsWritten,0),sqlCalls:queries.length,alarmWrites:this.alarmWrites-before,callbacks,examined:scan?.examined_seq??null,ack:sub?.ack_seq??null,pending,next,queries});
  }
}
export default {fetch(request,env){const u=new URL(request.url);return env.HUBS.get(env.HUBS.idFromName(u.searchParams.get('fixture')||'fictional-default')).fetch(request);}};
`;

test('native workerd cold/warm refill budgets stay page-bound for dense, sparse, unrelated histories and live floods', {timeout:30000},async()=>{
  const configuration=JSON.parse(readFileSync(new URL('../backend/wrangler.jsonc',import.meta.url),'utf8'));
  const bundle=await build({stdin:{contents:fixtureSource,sourcefile:'fictional-event-cost-worker.js',resolveDir:fileURLToPath(new URL('.',import.meta.url))},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:crypto']});
  let egress=0;
  const mf=new Miniflare(convertV4MiniflareOptions({name:'local-fictional-event-cost',modules:true,script:bundle.outputFiles[0].text,
    compatibilityDate:configuration.compatibility_date,compatibilityFlags:configuration.compatibility_flags||[],cf:false,telemetry:{enabled:false},
    durableObjects:{HUBS:{className:'EventCostFixture',useSQLite:true}},outboundService(){egress++;throw Error('No external fixture requests');}}));
  try{
    const request=async(fixture,path,parameters={})=>{
      const u=new URL('https://fictional-cost.example.test'+path);u.searchParams.set('fixture',fixture);for(const [key,value] of Object.entries(parameters))u.searchParams.set(key,value);
      const response=await mf.dispatchFetch(u.href);assert.equal(response.status,200);return response.json();
    };
    const unicode=await request('unicode','/unicode');
    assert.equal(unicode.nativeNulBody,'Fictional \u0000 KELVIN after nul','Native workerd TEXT preserves embedded NUL and the following Unicode text');
    assert.deepEqual(unicode.queuedSeq,[1,3],'Unchanged native SQL and JS pruning retain both Kelvin matches, including after NUL');
    assert.deepEqual(unicode.acceptedCursors,['relay1:1','relay1:3']);assert.equal(unicode.ack,3);
    const rollback=await request('schema-rollback','/schema-rollback');
    assert.equal(rollback.firstAbsent,true);assert.equal(rollback.upgradeAbsent,true);
    assert.equal(rollback.rowsRead,1);assert.equal(rollback.rowsWritten,0);
    assert.equal(rollback.queries.find(query=>query.query.includes('LIMIT 0')).rowsRead,0);
    assert.ok(!rollback.queries.some(({query})=>/json_extract|sqlite_master|\bCREATE\b/i.test(query)));
    const measured={};
    for(const mode of ['sparse','dense','cross']){
      await request(mode,'/seed',{mode,count:6000});measured[mode+'Cold']=await request(mode,'/cold');measured[mode+'Warm']=await request(mode,'/warm');
    }
    measured.schemaWarm=await request('dense','/schema-warm');
    for(let n=0;n<7;n++)measured.denseBackpressure=await request('dense','/warm');
    measured.denseFull=await request('dense','/warm');
    await request('flood','/seed',{mode:'flood',count:300});measured.floodCold=await request('flood','/cold');
    measured.floodAdmission=await request('flood','/flood',{count:2200});measured.floodFirst=await request('flood','/warm');measured.floodSecond=await request('flood','/warm');
    await request('legacy','/seed',{mode:'sparse',count:6000,legacy:1});measured.legacyIndexCold=await request('legacy','/cold');
    measured.emptyWarm=await request('sparse','/empty');
    const compact=Object.fromEntries(Object.entries(measured).map(([name,{rowsRead,rowsWritten,sqlCalls,alarmWrites,callbacks,examined,ack,pending}])=>[name,{rowsRead,rowsWritten,sqlCalls,alarmWrites,callbacks,examined,ack,pending}]));
    process.stdout.write('FICTIONAL_NATIVE_EVENT_COST '+JSON.stringify(compact)+'\n');
    for(const [name,result] of Object.entries(measured))if(result.rowsRead>2500||result.rowsWritten>1350)
      process.stdout.write('FICTIONAL_NATIVE_EVENT_COST_QUERIES '+JSON.stringify({name,queries:result.queries.filter(q=>q.rowsRead>200||q.rowsWritten>200)})+'\n');
    assert.equal(measured.sparseCold.examined,250);assert.equal(measured.sparseWarm.examined,500);assert.equal(measured.sparseWarm.ack,0);
    assert.equal(measured.schemaWarm.rowsRead,1);assert.equal(measured.schemaWarm.rowsWritten,0);assert.equal(measured.schemaWarm.alarmWrites,0);assert.equal(measured.schemaWarm.sqlCalls,2);
    assert.equal(measured.schemaWarm.queries.find(query=>query.query.includes('LIMIT 0')).rowsRead,0);
    assert.ok(!measured.schemaWarm.queries.some(({query})=>/json_extract|sqlite_master|\bCREATE\b/i.test(query)));
    assert.equal(measured.denseCold.pending,250);assert.equal(measured.denseWarm.pending,499);assert.equal(measured.denseFull.pending,1999);
    assert.equal(measured.crossCold.examined,6000);assert.equal(measured.crossWarm.examined,6000);
    assert.ok(measured.sparseCold.rowsRead<1700);assert.ok(measured.sparseWarm.rowsRead<1700);
    assert.ok(measured.denseCold.rowsRead<2000);assert.ok(measured.denseWarm.rowsRead<2500);
    assert.ok(measured.denseFull.rowsRead<2300,'Queue-full input reduces to capacity, instead of rereading 250 matches');
    assert.ok(measured.crossCold.rowsRead<100,'Kind index skips 5,999 unrelated public occurrences');
    assert.ok(measured.crossWarm.rowsRead<100);
    assert.equal(measured.floodCold.examined,250);assert.equal(measured.floodCold.pending,0);
    assert.equal(measured.floodAdmission.examined,250);assert.equal(measured.floodAdmission.pending,0);assert.equal(measured.floodAdmission.ack,0);
    assert.ok(!measured.floodAdmission.queries.some(({query})=>query.includes('SELECT COUNT(*) AS n FROM relay_outbox')),'Deferred live admission never scans queue capacity');
    assert.ok(measured.floodAdmission.rowsRead/2200<20,'Per-message native reads stay bounded behind a gap');
    assert.ok(measured.floodAdmission.rowsWritten/2200<=8,'Only the durable occurrence/body and their indexes are written');
    assert.equal(measured.floodFirst.ack,251);assert.equal(measured.floodFirst.callbacks,1);
    assert.equal(measured.floodSecond.ack,301);assert.equal(measured.floodSecond.callbacks,1);
    assert.ok(measured.floodFirst.rowsRead<1200);assert.ok(measured.floodSecond.rowsRead<1700);
    assert.ok(measured.floodFirst.rowsWritten<1350);assert.ok(measured.floodSecond.rowsWritten<1350);
    for(const name of ['sparseCold','sparseWarm','crossCold','crossWarm','emptyWarm'])assert.ok(measured[name].rowsWritten<50,name);
    // Each new occurrence writes the outbox table plus its four indexes.
    for(const name of ['denseCold','denseWarm','denseFull'])assert.ok(measured[name].rowsWritten<1350,name);
    // One-time legacy index build is reported separately from warmed budgets.
    assert.ok(measured.legacyIndexCold.rowsRead<16000);assert.ok(measured.legacyIndexCold.rowsWritten<16000);
    assert.ok(measured.emptyWarm.rowsRead<30);assert.equal(measured.emptyWarm.alarmWrites,0);
    assert.equal(measured.sparseWarm.callbacks,0);assert.equal(measured.denseWarm.callbacks,1);
    for(const result of Object.values(measured))assert.ok(result.alarmWrites<=2,'At most activation pre-wake plus one reschedule');
    const {plan}=await request('dense','/plan');assert.ok(plan.some(line=>line.includes('relay_event_kind_seq')));assert.ok(!plan.some(line=>line.includes('SCAN relay_events')));
    assert.equal(egress,0);
  }finally{await mf.dispose();}
});
