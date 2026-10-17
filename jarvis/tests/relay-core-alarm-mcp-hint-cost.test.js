import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions,Response as FixtureResponse} from 'miniflare';
import {COMMENT_URL,ISSUE_URL} from '../backend/publications.js';

// Whole anonymous HTTP hint requests, including Hub/importer/alarm wrappers.
// SQLite rows are native workerd cursor counts; fixtures are local fictional
// evidence, not production billing telemetry. Setup and observation are excluded.
const source=`
import worker,{Hub} from './worker.js';
import {publicationSchema,seedPublicationReconciliation} from './publications.js';
import {sharedStore,SHARED_OBJECT} from './shared.js';
const bytes=value=>value===undefined?0:new TextEncoder().encode(JSON.stringify(value)).length;
export class HintAdmissionCostFixture extends Hub {
  constructor(ctx,env){
    super(ctx,env,{publicationFetcher:async()=>Response.json([])});
    this.raw=ctx.storage;this.queries=[];
    this.counters={alarmSets:0,alarmDeletes:0,kvReads:0,kvReadJsonBytes:0,kvWrites:0,kvWriteJsonBytes:0,kvDeletes:0};
    const counters=this.counters,sql={exec:(query,...values)=>{
      const cursor=ctx.storage.sql.exec(query,...values);this.queries.push({query,cursor});return cursor;
    }};
    const storage=new Proxy(ctx.storage,{get:(target,key)=>{
      if(key==='sql')return sql;
      if(key==='setAlarm')return async value=>{counters.alarmSets++;return target.setAlarm(value);};
      if(key==='deleteAlarm')return async()=>{counters.alarmDeletes++;return target.deleteAlarm();};
      if(key==='get')return async name=>{const value=await target.get(name);counters.kvReads++;counters.kvReadJsonBytes+=bytes(value);return value;};
      if(key==='put')return async(name,value)=>{counters.kvWrites++;counters.kvWriteJsonBytes+=bytes(value);return target.put(name,value);};
      if(key==='delete')return async name=>{counters.kvDeletes++;return target.delete(name);};
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
    this.ctx=new Proxy(ctx,{get:(target,key)=>{if(key==='storage')return storage;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  }
  async fetch(request){
    const path=new URL(request.url).pathname;
    if(path==='/fixture/seed'){
      publicationSchema(this.ctx);
      sharedStore(this.ctx,'/internal/shared/message',{id:'00000000-0000-4000-8000-000000000601',body:'Fictional native hinted request'});
      seedPublicationReconciliation(this.ctx,Date.now(),null,{initialAlarmDelay:300000});
      return Response.json({seeded:true});
    }
    if(path==='/fixture/limit'){
      const now=Date.now();this.raw.sql.exec('INSERT OR REPLACE INTO shared_meta VALUES(?,?)','publisher-egress-budget',
        JSON.stringify({hour:Math.floor(now/3600000),minute:Math.floor(now/60000),total:12,hints:12,reconcile:0,burst:0}));
      return Response.json({limited:true});
    }
    if(path==='/fixture/reset'){this.queries=[];for(const key of Object.keys(this.counters))this.counters[key]=0;return Response.json({reset:true});}
    if(path!=='/fixture/costs')return super.fetch(request);
    const queries=this.queries.map(({query,cursor})=>({query:query.replace(/\\s+/g,' ').trim(),rowsRead:cursor.rowsRead,rowsWritten:cursor.rowsWritten}));
    const reservation=queries.filter(query=>query.query.includes('relay_core_alarm_wakes'));
    return Response.json({...this.counters,rowsRead:queries.reduce((n,q)=>n+q.rowsRead,0),rowsWritten:queries.reduce((n,q)=>n+q.rowsWritten,0),
      reservationRowsWritten:reservation.reduce((n,q)=>n+q.rowsWritten,0),
      reservationSchemaRowsWritten:reservation.filter(q=>q.query.startsWith('CREATE ')).reduce((n,q)=>n+q.rowsWritten,0),queries});
  }
}
const fixture=(object,path)=>object.fetch(new Request('https://internal/fixture/'+path));
export default {async fetch(request,env){
  const path=new URL(request.url).pathname,object=env.HUBS.get(env.HUBS.idFromName(SHARED_OBJECT));
  if(path==='/seed')return fixture(object,'seed');
  if(path==='/limit')return fixture(object,'limit');
  const id={'/accepted':601,'/duplicate':601,'/refusal':602,'/cached':602,'/limited':603,'/limited-again':604}[path];
  if(!id)return new Response('Unknown fictional hint case',{status:404});
  await fixture(object,'reset');
  const response=await worker.fetch(new Request(env.RELAY_MCP_ORIGIN+'/shared/import-hint',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({commentId:id})}),env);
  const receipt=await response.json(),costs=await (await fixture(object,'costs')).json();
  return Response.json({status:response.status,receipt,...costs});
}};
`;

test('native whole-worker duplicate, cached and rate-limited hints avoid mutation admission', {timeout:30000},async()=>{
  const configuration=JSON.parse(readFileSync(new URL('../backend/wrangler.jsonc',import.meta.url),'utf8'));
  const bundle=await build({stdin:{contents:source,resolveDir:fileURLToPath(new URL('../backend/',import.meta.url)),sourcefile:'fictional-hint-admission-cost.js'},
    bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:crypto']});
  let egress=0;
  const mf=new Miniflare(convertV4MiniflareOptions({name:'local-fictional-hint-admission-cost',modules:true,script:bundle.outputFiles[0].text,
    compatibilityDate:configuration.compatibility_date,compatibilityFlags:configuration.compatibility_flags||[],cf:false,telemetry:{enabled:false},
    bindings:{RELAY_MCP_ENABLED:'true',RELAY_MCP_ORIGIN:'https://relay.example.test'},
    durableObjects:{HUBS:{className:'HintAdmissionCostFixture',useSQLite:true}},outboundService(request){
      egress++;assert.equal(request.method,'GET');assert.equal(request.headers.get('Authorization'),null);assert.equal(request.headers.get('Cookie'),null);
      if(request.url===COMMENT_URL+602)return FixtureResponse.json({},{status:404});
      assert.equal(request.url,COMMENT_URL+601);
      return FixtureResponse.json({id:601,user:{id:183016859},issue_url:ISSUE_URL,created_at:'2026-10-08T00:00:00Z',
        body:JSON.stringify({schema:'jarvis-coordination-v2',eventId:'00000000-0000-4000-8000-000000000602',
          requestId:'00000000-0000-4000-8000-000000000601',attemptId:'00000000-0000-4000-8000-000000000603',
          stage:'final',resultVersion:1,body:'Fictional native imported final',artifacts:[]})});
    }}));
  const run=async name=>{
    const before=egress,result=await (await mf.dispatchFetch('https://cost.example.test/'+name)).json();
    return {...result,egress:egress-before};
  };
  try{
    assert.equal((await mf.dispatchFetch('https://cost.example.test/seed')).status,200);
    const accepted=await run('accepted');assert.equal(accepted.status,200);assert.equal(accepted.receipt.status,'imported');assert.equal(accepted.egress,1);
    assert.equal(accepted.reservationSchemaRowsWritten,5,'The first admitted hint creates the optional reservation table and two indexes');
    assert.equal(accepted.reservationRowsWritten-accepted.reservationSchemaRowsWritten,5,'One admitted attempt inserts and deletes one indexed reservation');
    assert.equal(accepted.alarmSets,2);assert.equal(accepted.alarmDeletes,0);
    const duplicate=await run('duplicate');assert.equal(duplicate.status,200);assert.deepEqual(duplicate.receipt,accepted.receipt);
    const refusal=await run('refusal');assert.equal(refusal.status,422);assert.equal(refusal.egress,1);
    assert.equal(refusal.reservationRowsWritten,0);assert.equal(refusal.alarmSets,0);assert.equal(refusal.alarmDeletes,0);
    const cached=await run('cached');assert.equal(cached.status,422);assert.equal(cached.receipt.status,'retry-later');
    assert.equal((await mf.dispatchFetch('https://cost.example.test/limit')).status,200);
    const limited=await run('limited'),limitedAgain=await run('limited-again');
    for(const result of [limited,limitedAgain]){assert.equal(result.status,429);assert.equal(result.receipt.reason,'egress_budget');}
    const results={duplicate,cached,limited,limitedAgain};
    process.stdout.write('LOCAL_FICTIONAL_WHOLE_WORKER_HINT_NATIVE_COST '+JSON.stringify(Object.fromEntries(Object.entries({accepted,refusal,...results}).map(([name,{queries,receipt,...cost}])=>[name,
      {scope:'whole anonymous worker HTTP hint request, native shared Hub SQL and alarm calls',...cost}])))+'\n');
    for(const result of Object.values(results)){
      assert.equal(result.egress,0);assert.equal(result.kvReads,0);assert.equal(result.kvWrites,0);assert.equal(result.kvDeletes,0);
      assert.equal(result.rowsWritten,0);assert.equal(result.reservationRowsWritten,0);assert.equal(result.alarmSets,0);assert.equal(result.alarmDeletes,0);
    }
    assert.equal(egress,2);
  }finally{await mf.dispose();}
});
