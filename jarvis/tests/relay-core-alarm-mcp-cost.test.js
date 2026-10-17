import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

// Whole worker HTTP/MCP request accounting across the shared OAuth and legacy
// objects, using native workerd SQLite cursors and JSON KV value byte counts.
// Fixtures/counters are local evidence, not production billing telemetry.
const source=`
import worker,{Hub} from './worker.js';
import {publicationSchema} from './publications.js';
import {relayOAuthStore} from './relay-oauth.js';
import {SHARED_OBJECT,PUBLIC_KEY} from './shared.js';
import {RELAY_OWNER,RELAY_CALLBACK,RELAY_INBOX,RELAY_VERSION,random,hash,challenge} from './relay-common.js';
const bytes=value=>value===undefined?0:new TextEncoder().encode(JSON.stringify(value)).length;
export class CoreAlarmCostFixture extends Hub {
  constructor(ctx,env){
    const counters={egress:0,sets:0,deletes:0,kvReads:0,kvReadJsonBytes:0,kvWrites:0,kvWriteJsonBytes:0,kvDeletes:0};
    super(ctx,env,{publicationFetcher:async()=>{counters.egress++;return Response.json([]);}});
    this.counters=counters;this.queries=[];
    const sql={exec:(query,...values)=>{const cursor=ctx.storage.sql.exec(query,...values);this.queries.push({query,cursor});return cursor;}};
    const storage=new Proxy(ctx.storage,{get:(target,key)=>{
      if(key==='sql')return sql;
      if(key==='setAlarm')return async value=>{counters.sets++;return target.setAlarm(value);};
      if(key==='deleteAlarm')return async()=>{counters.deletes++;return target.deleteAlarm();};
      if(key==='get')return async name=>{const value=await target.get(name);counters.kvReads++;counters.kvReadJsonBytes+=bytes(value);return value;};
      if(key==='put')return async(name,value)=>{counters.kvWrites++;counters.kvWriteJsonBytes+=bytes(value);return target.put(name,value);};
      if(key==='delete')return async name=>{counters.kvDeletes++;return target.delete(name);};
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
    this.ctx=new Proxy(ctx,{get:(target,key)=>{if(key==='storage')return storage;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  }
  async seed(count){
    publicationSchema(this.ctx);const sql=this.ctx.storage.sql;
    sql.exec('CREATE TABLE fixture_numbers(n INTEGER PRIMARY KEY)');
    sql.exec('INSERT INTO fixture_numbers WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM numbers WHERE n<?) SELECT n FROM numbers',count);
    sql.exec("INSERT INTO shared_entries(id,kind,body,created_at) SELECT printf('00000000-0000-4000-8000-%012d',n),'user','Fictional retained public request','2026-10-08T00:00:00Z' FROM fixture_numbers");
    sql.exec("INSERT OR IGNORE INTO public_changes(kind,item_id,request_id) SELECT 'entry',id,id FROM shared_entries");
    sql.exec("INSERT INTO imported_comments(comment_id,publication,imported) SELECT n,?,1 FROM fixture_numbers",JSON.stringify({type:'briefing',body:'Fictional processed publication'}));
    this.access=random();
    const client=random(),grantId=random(),code=random(),accessHash=await hash(this.access),resource=this.env.RELAY_MCP_ORIGIN+'/relay/mcp';
    const registry=async body=>{const response=await relayOAuthStore(this.ctx,body);if(!response.ok)throw Error('Fictional registry seed failed');return response.json();};
    await registry({op:'put',key:'client:'+client,category:'client',value:{redirect:RELAY_CALLBACK},expiresAt:Date.now()+600000});
    const params={client_id:client,redirect_uri:RELAY_CALLBACK,code_challenge:await challenge(random()),scope:'relay:read'};
    await registry({op:'authorize',grantId,codeKey:'code:'+await hash(code),params,resource});
    await registry({op:'exchange',key:'code:'+await hash(code),match:{client_id:client,redirect_uri:RELAY_CALLBACK,challenge:params.code_challenge,resource},accessKey:'access:'+accessHash,refreshKey:'refresh:'+await hash(random())});
    this.principal={principal:RELAY_OWNER,grantId,scopes:['relay:read'],accessHash};
    await this.read();
  }
  read(){return super.fetch(new Request('https://internal/internal/relay/rpc',{method:'POST',body:JSON.stringify({principal:this.principal,
    rpc:{method:'tools/call',params:{_meta:{},name:'relay_list_pending',arguments:{inbox_id:RELAY_INBOX,cursor:'4000',limit:10}}}})}));}
  async fetch(request){
    const path=new URL(request.url).pathname;
    if(path==='/fixture/seed'){await this.seed(5000);return Response.json({seeded:5000});}
    if(path==='/fixture/auth')return Response.json({access:this.access});
    if(path==='/fixture/reset'){this.queries=[];for(const key of Object.keys(this.counters))this.counters[key]=0;return Response.json({reset:true});}
    if(path==='/fixture/legacy-seed'){
      await this.ctx.storage.put('state',{messages:Array.from({length:20},(_,i)=>({id:'00000000-0000-4000-8000-'+String(90001+i).padStart(12,'0'),role:'user',body:'Fictional legacy request '+i,createdAt:'2026-10-08T00:00:00Z'})),posts:[]});
      return Response.json({seeded:20});
    }
    if(path==='/fixture/due'){
      const sql=this.ctx.storage.sql;
      for(const key of ['publisher-next-attempt','publisher-local-next-attempt'])sql.exec('INSERT OR REPLACE INTO shared_meta VALUES(?,?)',key,JSON.stringify(Date.now()));
      const checkpoint=JSON.parse([...sql.exec("SELECT value FROM shared_meta WHERE key='legacy-inbox-checkpoint'")][0].value);
      sql.exec('INSERT OR REPLACE INTO shared_meta VALUES(?,?)','legacy-inbox-checkpoint',JSON.stringify({...checkpoint,nextAt:Date.now()}));
      return Response.json({due:true});
    }
    if(path==='/fixture/alarm'){await super.alarm();return Response.json({nextAlarm:await this.ctx.storage.getAlarm()});}
    if(path!=='/fixture/costs')return super.fetch(request);
    const queries=this.queries.map(({query,cursor})=>({query:query.replace(/\\s+/g,' ').trim(),rowsRead:cursor.rowsRead,rowsWritten:cursor.rowsWritten}));
    return Response.json({rowsRead:queries.reduce((n,q)=>n+q.rowsRead,0),rowsWritten:queries.reduce((n,q)=>n+q.rowsWritten,0),
      ...this.counters,queries});
  }
}
const fixture=(object,path)=>object.fetch(new Request('https://internal/fixture/'+path));
function mcp(env,access){return new Request(env.RELAY_MCP_ORIGIN+'/relay/mcp',{method:'POST',headers:{Authorization:'Bearer '+access,
  'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':RELAY_VERSION,'Mcp-Method':'tools/call','Mcp-Name':'relay_list_pending'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{_meta:{'io.modelcontextprotocol/protocolVersion':RELAY_VERSION,'io.modelcontextprotocol/clientCapabilities':{}},name:'relay_list_pending',arguments:{inbox_id:RELAY_INBOX,cursor:'4000',limit:10}}})});}
export default {async fetch(request,env){
  const path=new URL(request.url).pathname,shared=env.HUBS.get(env.HUBS.idFromName(SHARED_OBJECT)),legacy=env.HUBS.get(env.HUBS.idFromName(await hash(PUBLIC_KEY)));
  if(path==='/seed'){const response=await fixture(shared,'seed');return response;}
  if(!['/read','/alarm','/reconcile','/write'].includes(path))return new Response('Unknown fictional cost case',{status:404});
  const {access}=await (await fixture(shared,'auth')).json();
  if(path==='/reconcile'){await fixture(legacy,'legacy-seed');await fixture(shared,'due');}
  await Promise.all([shared,legacy].map(object=>fixture(object,'reset')));
  let response,result;
  if(path==='/alarm'){response=await fixture(shared,'alarm');result=await response.json();}
  else if(path==='/write'){
    response=await worker.fetch(new Request(env.RELAY_MCP_ORIGIN+'/shared/messages',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:'00000000-0000-4000-8000-000000990001',body:'Fictional public mutation cost'})}),env);
    const data=await response.json();result={entryId:data.entry?.id,error:data.error||null};
  }
  else {response=await worker.fetch(mcp(env,access),env);const data=await response.json();result={messages:data.result?.structuredContent?.messages.length,error:data.error||null};}
  const details=await Promise.all([shared,legacy].map(async(object)=> (await fixture(object,'costs')).json()));
  const total=Object.fromEntries(['rowsRead','rowsWritten','egress','sets','deletes','kvReads','kvReadJsonBytes','kvWrites','kvWriteJsonBytes','kvDeletes'].map(key=>[key,details.reduce((n,data)=>n+data[key],0)]));
  const queries=details.flatMap(data=>data.queries),reservation=queries.filter(query=>query.query.includes('relay_core_alarm_wakes'));
  return Response.json({status:response.status,result,...total,alarmSets:total.sets,alarmDeletes:total.deletes,
    reservationRowsRead:reservation.reduce((n,q)=>n+q.rowsRead,0),reservationRowsWritten:reservation.reduce((n,q)=>n+q.rowsWritten,0),
    objects:details.map(({queries,...cost},i)=>({kind:i?'legacy':'shared-oauth',...cost})),queries});
}};
`;

test('native local fictional MCP and alarm costs stay bounded with 5000 retained rows', {timeout:30000},async()=>{
  const configuration=JSON.parse(readFileSync(new URL('../backend/wrangler.jsonc',import.meta.url),'utf8'));
  const bundle=await build({stdin:{contents:source,resolveDir:fileURLToPath(new URL('../backend/',import.meta.url)),sourcefile:'fictional-core-cost.js'},
    bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:crypto']});
  let external=0;
  const mf=new Miniflare(convertV4MiniflareOptions({name:'local-fictional-core-alarm-cost',modules:true,script:bundle.outputFiles[0].text,
    compatibilityDate:configuration.compatibility_date,compatibilityFlags:configuration.compatibility_flags||[],cf:false,telemetry:{enabled:false},
    bindings:{RELAY_MCP_ENABLED:'true',RELAY_MCP_ORIGIN:'https://relay.example.test'},
    durableObjects:{HUBS:{className:'CoreAlarmCostFixture',useSQLite:true}},outboundService(){external++;throw Error('No external fixture requests');}}));
  try{
    assert.equal((await mf.dispatchFetch('https://cost.example.test/seed')).status,200);
    const results={};for(const name of ['read','alarm','reconcile','read','write']){const result=await (await mf.dispatchFetch('https://cost.example.test/'+name)).json();results[name]=result;
      assert.equal(result.status,name==='write'?201:200);assert.ok(result.rowsRead<600,'Whole fixture request must not scan retained history');
      if(name==='read'){assert.equal(result.result.messages,10);assert.equal(result.result.error,null);assert.equal(result.egress,0);assert.equal(result.rowsWritten,0);assert.equal(result.alarmSets,0);assert.equal(result.alarmDeletes,0);assert.equal(result.kvReads,0);}
      else if(name==='alarm'){assert.equal(result.egress,0);assert.ok(result.rowsWritten<=10);assert.ok(result.alarmSets<=2);assert.equal(result.alarmDeletes,0);}
      else if(name==='write'){
        assert.equal(result.result.entryId,'00000000-0000-4000-8000-000000990001');assert.equal(result.result.error,null);
        assert.equal(result.egress,0);assert.equal(result.kvReads,0);assert.equal(result.kvWrites,0);
        assert.ok(result.rowsWritten<40);assert.equal(result.reservationRowsWritten,5);
        assert.equal(result.alarmSets,2);assert.equal(result.alarmDeletes,0);
      }
      else {assert.equal(result.egress,1);assert.equal(result.kvReads,1);assert.ok(result.kvReadJsonBytes>1000);assert.equal(result.kvWrites,0);assert.ok(result.rowsWritten<300);assert.ok(result.alarmSets<=2);}
    }
    process.stdout.write('LOCAL_FICTIONAL_CORE_NATIVE_COST '+JSON.stringify(Object.fromEntries(Object.entries(results).map(([name,result])=>[name,
      {scope:'whole worker request across shared OAuth and legacy objects',rowsRead:result.rowsRead,rowsWritten:result.rowsWritten,
        kvReads:result.kvReads,kvReadJsonBytes:result.kvReadJsonBytes,kvWrites:result.kvWrites,kvWriteJsonBytes:result.kvWriteJsonBytes,
        egress:result.egress,alarmSets:result.alarmSets,alarmDeletes:result.alarmDeletes,
        reservationRowsRead:result.reservationRowsRead,reservationRowsWritten:result.reservationRowsWritten}])) )+'\n');
    assert.equal(external,0);
  }finally{await mf.dispose();}
});
