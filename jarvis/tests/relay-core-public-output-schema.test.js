import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

// Real HTTP OAuth/MCP routing, Hub reconciliation and native workerd SQLite.
// Accounts, retained reports and provider responses are local fictional data.
const source=`
import worker,{Hub} from './worker.js';
import {publicationSchema,syncPublications,COMMENTS_URL} from './publications.js';
import {sharedStore,syncLegacyInbox,SHARED_OBJECT,PUBLIC_KEY} from './shared.js';
import {relayOAuthStore} from './relay-oauth.js';
import {COORDINATION_CATALOG_CURSOR} from './public-coordination-tools.js';
import {RELAY_OWNER,RELAY_CALLBACK,RELAY_INBOX,RELAY_VERSION,random,hash,challenge} from './relay-common.js';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
export class PublicOutputSchemaFixture extends Hub {
  constructor(ctx,env){
    const state={failure:false,fetches:0};
    super(ctx,env,{publicationFetcher:async(url,init)=>{
      if(new URL(url).origin+new URL(url).pathname!==COMMENTS_URL||init.redirect!=='manual'||init.headers.Authorization||init.headers.Cookie)
        throw Error('Unexpected fictional publication fetch');
      state.fetches++;
      return state.failure?Response.json({},{status:429,headers:{'Retry-After':'900'}}):Response.json([]);
    }});this.state=state;
  }
  put(key,value){this.ctx.storage.sql.exec('INSERT OR REPLACE INTO shared_meta VALUES(?,?)',key,JSON.stringify(value));}
  async setup(variant){
    publicationSchema(this.ctx);this.put('publication-imported',true);
    if(sharedStore(this.ctx,'/internal/shared/message',{id:id(1),body:'Fictional schema contract request'}).status!==201)throw Error('Fictional request seed failed');
    const first={schema:'jarvis-coordination-v2',eventId:id(2),requestId:id(1),attemptId:id(3),stage:'final',resultVersion:1,
      body:'Fictional retained immutable result',artifacts:[{id:id(4),revision:1,label:'Fictional source',url:'https://artifact.example.test/schema-proof'}]};
    const progress={schema:'jarvis-coordination-v2',eventId:id(5),requestId:id(1),attemptId:id(6),stage:'progress',body:'Fictional later progress',artifacts:[]};
    for(const [index,payload] of [first,progress].entries()){
      const response=sharedStore(this.ctx,'/internal/shared/coordination',{payload,provenance:{source:'github-issue',repository:'braydenparker999/jarvis',
        issue:2,commentId:100+index,authorId:183016859,publishedAt:'2026-10-08T00:00:00Z'}});
      if(response.status!==201)throw Error('Fictional report seed failed');
    }
    if(variant==='legacy-null')await syncPublications(this.ctx,this.publicationFetcher,Date.now());
    if(['default','legacy-null','retained-health'].includes(variant)){
      await syncLegacyInbox(this.ctx,this.env,Date.now());
      this.put('publisher-pass-not-before',Date.now()+3600000);
    }
    if(variant==='retained-health'){
      this.ctx.storage.sql.exec(\`INSERT INTO imported_comments(comment_id,publication,imported)
        WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM numbers WHERE n<922)
        SELECT n,json_object('type','briefing','id',printf('00000000-0000-4000-8000-%012d',n+10000),
          'title','Fictional retained briefing','body','Fictional historical publication','date','2026-10-08','createdAt','2026-10-08T00:00:00Z'),
          CASE WHEN n<=711 THEN 0 ELSE 2 END FROM numbers\`);
      // Restore the old producer's full COUNT(*) snapshot, which can survive
      // a throttled initial pass without being replaced by bounded summaries.
      const pending=[...this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM imported_comments WHERE imported=0')][0].n;
      const conflicts=[...this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM imported_comments WHERE imported=2')][0].n;
      const stamp=new Date().toISOString();
      this.put('publisher-status',{ok:true,lastAttempt:stamp,lastSuccessfulSync:stamp,catchingUp:true,pending,conflicts});
    }
    this.access=random();
    const client=random(),grantId=random(),code=random(),accessHash=await hash(this.access),resource=this.env.RELAY_MCP_ORIGIN+'/relay/mcp';
    const registry=async body=>{const response=await relayOAuthStore(this.ctx,body);if(!response.ok)throw Error('Fictional registry seed failed');return response.json();};
    await registry({op:'put',key:'client:'+client,category:'client',value:{redirect:RELAY_CALLBACK},expiresAt:Date.now()+600000});
    const params={client_id:client,redirect_uri:RELAY_CALLBACK,code_challenge:await challenge(random()),scope:'relay:read relay:reply relay:events'};
    await registry({op:'authorize',grantId,codeKey:'code:'+await hash(code),params,resource});
    await registry({op:'exchange',key:'code:'+await hash(code),match:{client_id:client,redirect_uri:RELAY_CALLBACK,challenge:params.code_challenge,resource},
      accessKey:'access:'+accessHash,refreshKey:'refresh:'+await hash(random())});
  }
  async fetch(request){
    const path=new URL(request.url).pathname;
    if(path==='/fixture/setup'){await this.setup((await request.json()).variant);return Response.json({access:this.access});}
    if(path==='/fixture/switch'){
      const {variant}=await request.json(),now=Date.now();this.state.failure=variant==='http-backoff';
      this.put('publisher-next-attempt',now);this.put('publisher-local-next-attempt',now);
      if(variant==='egress-budget')this.put('publisher-egress-budget',{hour:Math.floor(now/3600000),minute:Math.floor(now/60000),total:48,hints:12,reconcile:36,burst:0});
      if(variant==='legacy-failure'){
        const checkpoint=JSON.parse([...this.ctx.storage.sql.exec("SELECT value FROM shared_meta WHERE key='legacy-inbox-checkpoint'")][0].value);
        this.put('legacy-inbox-checkpoint',{...checkpoint,nextAt:now});
      }
      return Response.json({switched:true});
    }
    if(path==='/fixture/legacy-failure'){await this.ctx.storage.put('state',{messages:'Fictional invalid retained legacy state',posts:[]});return Response.json({seeded:true});}
    if(path==='/fixture/fetches')return Response.json({fetches:this.state.fetches});
    return super.fetch(request);
  }
}
const fixture=(object,path,body)=>object.fetch(new Request('https://internal/fixture/'+path,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined}));
export default {async fetch(request,env){
  const variant=new URL(request.url).searchParams.get('variant'),shared=env.HUBS.get(env.HUBS.idFromName(SHARED_OBJECT));
  const {access}=await (await fixture(shared,'setup',{variant})).json();
  const call=async(method,params={})=>{
    const response=await worker.fetch(new Request(env.RELAY_MCP_ORIGIN+'/relay/mcp',{method:'POST',
      headers:{Authorization:'Bearer '+access,'Content-Type':'application/json',Accept:'application/json, text/event-stream',
        'MCP-Protocol-Version':RELAY_VERSION,'Mcp-Method':method,...(method==='tools/call'?{'Mcp-Name':params.name}:{})},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{...params,_meta:{'io.modelcontextprotocol/protocolVersion':RELAY_VERSION,
        'io.modelcontextprotocol/clientCapabilities':{}}}})}),env);
    const data=await response.json();if(response.status!==200||data.error||data.result?.isError)throw Error('Native fictional MCP '+method+' failed: '+JSON.stringify(data.error||data.result));return data.result;
  };
  const firstCatalog=await call('tools/list'),secondCatalog=await call('tools/list',{cursor:COORDINATION_CATALOG_CURSOR});
  const argumentsFor=name=>({inbox_id:RELAY_INBOX,limit:1,...(name==='relay_read_public_result'?{message_id:id(1)}:{})});
  if(['http-backoff','egress-budget','legacy-failure'].includes(variant)){
    await call('tools/call',{name:'relay_read_public_result',arguments:argumentsFor('relay_read_public_result')});
    await fixture(shared,'switch',{variant});
  }
  if(variant==='legacy-failure')await fixture(env.HUBS.get(env.HUBS.idFromName(await hash(PUBLIC_KEY))),'legacy-failure');
  const outputs={};
  for(const name of ['relay_read_public_result','relay_read_public_changes']){
    outputs[name]=[];let cursor=null;
    do{
      const result=await call('tools/call',{name,arguments:{...argumentsFor(name),...(cursor?{cursor}:{})}});
      outputs[name].push(result);cursor=result.structuredContent.nextCursor;
      if(outputs[name].length>20)throw Error('Unexpected fictional pagination');
    }while(cursor);
  }
  const {fetches}=await (await fixture(shared,'fetches')).json();
  return Response.json({firstCatalog,secondCatalog,outputs,fetches});
}};
`;

// Validate every assertion keyword used by the advertised schemas, including
// closed nested objects. Unsupported keywords fail instead of being ignored.
const keywords=new Set(['type','properties','required','additionalProperties','items','anyOf','const','enum',
  'minimum','maximum','minLength','maxLength','minItems','maxItems','maxProperties','pattern','format']);
function assertSchema(value,schema,path='$'){
  for(const key of Object.keys(schema))assert.ok(keywords.has(key),'Unsupported schema keyword '+key);
  if(schema.anyOf)assert.ok(schema.anyOf.some(branch=>{try{assertSchema(value,branch,path);return true;}catch{return false;}}),path+' must match anyOf');
  if(schema.type){
    const matches=type=>type==='null'?value===null:type==='array'?Array.isArray(value):type==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):
      type==='integer'?Number.isInteger(value):typeof value===type;
    assert.ok([schema.type].flat().some(matches),path+' has wrong type');
  }
  if(Object.hasOwn(schema,'const'))assert.deepEqual(value,schema.const,path+' has wrong constant');
  if(schema.enum)assert.ok(schema.enum.includes(value),path+' has wrong enum value');
  if(typeof value==='number'){
    if(schema.minimum!==undefined)assert.ok(value>=schema.minimum,path+' is below minimum');
    if(schema.maximum!==undefined)assert.ok(value<=schema.maximum,path+' exceeds maximum');
  }
  if(typeof value==='string'){
    const length=[...value].length;
    if(schema.minLength!==undefined)assert.ok(length>=schema.minLength,path+' is too short');
    if(schema.maxLength!==undefined)assert.ok(length<=schema.maxLength,path+' is too long');
    if(schema.pattern)assert.match(value,new RegExp(schema.pattern),path+' has wrong pattern');
    if(schema.format==='uuid')assert.match(value,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,path+' is not a UUID');
    else if(schema.format==='date-time'){
      assert.match(value,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/i,path+' is not RFC3339');
      assert.ok(Number.isFinite(Date.parse(value)),path+' has invalid date');
    }else if(schema.format==='uri')assert.ok(new URL(value).protocol,path+' has invalid URI');
    else assert.ok(!schema.format,'Unsupported format '+schema.format);
  }
  if(Array.isArray(value)){
    if(schema.minItems!==undefined)assert.ok(value.length>=schema.minItems,path+' has too few items');
    if(schema.maxItems!==undefined)assert.ok(value.length<=schema.maxItems,path+' has too many items');
    if(schema.items)value.forEach((item,index)=>assertSchema(item,schema.items,path+'['+index+']'));
  }else if(value!==null&&typeof value==='object'){
    if(schema.maxProperties!==undefined)assert.ok(Object.keys(value).length<=schema.maxProperties,path+' has too many properties');
    for(const key of schema.required||[])assert.ok(Object.hasOwn(value,key),path+'.'+key+' is required');
    for(const [key,item] of Object.entries(value)){
      if(schema.additionalProperties===false)assert.ok(Object.hasOwn(schema.properties||{},key),path+'.'+key+' is not allowed by advertised schema');
      if(schema.properties?.[key])assertSchema(item,schema.properties[key],path+'.'+key);
    }
  }
}

test('native public MCP result pages strictly match their advertised v2 schemas across publisher status variants', {timeout:30000},async()=>{
  const configuration=JSON.parse(readFileSync(new URL('../backend/wrangler.jsonc',import.meta.url),'utf8'));
  const bundle=await build({stdin:{contents:source,resolveDir:fileURLToPath(new URL('../backend/',import.meta.url)),sourcefile:'fictional-public-output-schema.js'},
    bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:crypto']});
  for(const variant of ['default','retained-health','healthy','http-backoff','egress-budget','legacy-failure','legacy-null']){
    let external=0;
    const mf=new Miniflare(convertV4MiniflareOptions({name:'local-fictional-public-output-schema-'+variant,modules:true,script:bundle.outputFiles[0].text,
      compatibilityDate:configuration.compatibility_date,compatibilityFlags:configuration.compatibility_flags||[],cf:false,telemetry:{enabled:false},
      bindings:{RELAY_MCP_ENABLED:'true',RELAY_MCP_ORIGIN:'https://relay.example.test'},
      durableObjects:{HUBS:{className:'PublicOutputSchemaFixture',useSQLite:true}},outboundService(){external++;throw Error('No external fixture requests');}}));
    try{
      const response=await mf.dispatchFetch('https://schema.example.test/?variant='+variant);
      if(response.status!==200)assert.fail('Native fictional schema fixture failed: '+await response.text());
      const data=await response.json(),first=data.firstCatalog.tools;
      assert.deepEqual(first.map(tool=>tool.name),['relay_list_pending','relay_read_conversation','relay_reply','relay_event_access_status']);
      assert.equal(data.firstCatalog.nextCursor,'public-coordination-v2');
      const fingerprint=createHash('sha256').update(JSON.stringify(first.map(({name,inputSchema,outputSchema})=>({name,inputSchema,outputSchema})))).digest('hex');
      assert.equal(fingerprint,'fa58e0fb26a21d8289bdeffca41ce5af079ee765b5dbb731ceb1c5264af15935','The original first-page input/output schemas remain byte-compatible');
      const proof=data.secondCatalog.tools.map(tool=>({name:tool.name,
        undeclared:Object.keys(data.outputs[tool.name][0].structuredContent).filter(key=>!Object.hasOwn(tool.outputSchema.properties,key))}));
      process.stdout.write('LOCAL_FICTIONAL_NATIVE_PUBLIC_SCHEMA '+JSON.stringify({variant,firstCatalogSchemaFingerprint:fingerprint,proof})+'\n');
      const publisher=data.outputs.relay_read_public_result[0].structuredContent.publisher;
      if(variant==='default'){assert.equal(publisher.ok,false);assert.equal(publisher.error,'Publication sync has not run yet');assert.equal(data.fetches,0);}
      else if(variant==='retained-health'){assert.equal(publisher.ok,true);assert.equal(publisher.pending,711);assert.equal(publisher.conflicts,211);assert.equal(data.fetches,0);assert.equal(publisher.reconciliation,undefined);}
      else if(variant==='http-backoff'){assert.equal(publisher.ok,false);assert.equal(publisher.httpStatus,429);assert.ok(publisher.lastSuccessfulSync);assert.ok(publisher.retryAt);}
      else if(variant==='egress-budget'){assert.equal(publisher.ok,false);assert.equal(publisher.reason,'egress_budget');assert.ok(publisher.lastSuccessfulSync);}
      else if(variant==='legacy-failure'){assert.equal(publisher.ok,true);assert.equal(publisher.reconciliation.legacy.ok,false);assert.equal(publisher.reconciliation.legacy.error,'Legacy inbox unavailable');}
      else if(variant==='legacy-null'){assert.equal(publisher.ok,true);assert.equal(publisher.reconciliation.legacy,null);}
      else {assert.equal(publisher.ok,true);assert.equal(publisher.reconciliation.legacy.ok,true);}
      for(const tool of data.secondCatalog.tools){
        assert.equal(tool.outputSchema.additionalProperties,false);
        assert.ok(data.outputs[tool.name].length>=2,'Actual fenced pagination is covered');
        for(const result of data.outputs[tool.name]){
          assert.equal(result.isError,false);assert.equal(result.structuredContent.serviceVersion,7);
          assert.deepEqual(JSON.parse(result.content[0].text),result.structuredContent);
          assertSchema(result.structuredContent,tool.outputSchema);
        }
        const valid=data.outputs[tool.name][0].structuredContent;
        const invalid=mutate=>{const value=structuredClone(valid);mutate(value);assert.throws(()=>assertSchema(value,tool.outputSchema));};
        invalid(value=>{value.unadvertised=true;});
        invalid(value=>{value.serviceVersion=8;});
        invalid(value=>{delete value.publisher;});
        invalid(value=>{value.publisher.grantId='fictional forbidden authority';});
        invalid(value=>{value.publisher.pending=-1;});
        invalid(value=>{value.publisher.pending=Number.MAX_SAFE_INTEGER+1;});
        invalid(value=>{value.publisher.conflicts=Number.MAX_SAFE_INTEGER+1;});
        invalid(value=>{value.publisher.conflicts=0.5;});
        invalid(value=>{value.publisher.error='x'.repeat(4097);});
        invalid(value=>{value.publisher.httpStatus='429';});
        invalid(value=>{value.publisher.reason='execute';});
        if(valid.publisher.reconciliation){
          invalid(value=>{value.publisher.reconciliation.callback='https://callback.example.test/forbidden';});
          invalid(value=>{value.publisher.reconciliation.enabled=false;});
          invalid(value=>{value.publisher.reconciliation.nextAttemptAt='later';});
          invalid(value=>{value.publisher.reconciliation.legacy={ok:true,lastAttempt:'2026-10-08T00:00:00Z',secret:'fictional forbidden value'};});
        }
      }
      assert.equal(external,0);
    }finally{await mf.dispose();}
  }
});
