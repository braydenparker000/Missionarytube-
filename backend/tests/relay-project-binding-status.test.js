import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayFixture} from './relay-fixture.js';
import {relayRpc} from '../relay-connector.js';
import {projectAdminTools,projectParticipationTools} from '../relay-project-tools.js';
import {relayOAuthStore} from '../relay-oauth.js';
import {RELAY_OWNER,RELAY_VERSION,hash} from '../relay-common.js';

const meta={'io.modelcontextprotocol/protocolVersion':RELAY_VERSION,'io.modelcontextprotocol/clientCapabilities':{}};
const status={method:'tools/call',params:{_meta:meta,name:'relay_project_binding_status',arguments:{}}};
async function setup(t,{bindings=true}={}) {
  const s=createRelayFixture({env:{RELAY_OWNER_ENABLED:'true',RELAY_PROJECT_ENABLED:'false',RELAY_PROJECT_ADMIN_ENABLED:'false',RELAY_PROJECT_EVENTS_ENABLED:'false'}});
  t.after(()=>s.close());
  const {ctx,db}=s.object('jarvis-shared-v2'),access='1'.repeat(64),accessHash=await hash(access),grantId='2'.repeat(64),scope='relay:read relay:reply relay:events relay:owner',expires=Date.now()+3600000;
  const resource=s.env.RELAY_MCP_ORIGIN+'/relay/mcp';
  const grant={principal:RELAY_OWNER,revoked:false,resource,scope,client_id:'fictional-client',expiresAt:expires};
  relayOAuthStore(ctx,{op:'get',key:'fixture-init'});
  for(const [key,category,value] of [['grant:'+grantId,'grant',grant],['access:'+accessHash,'access',{grantId,resource,scope,client_id:grant.client_id}]]){
    db.prepare('INSERT INTO relay_oauth VALUES(?,?,?,?)').run(key,category,JSON.stringify(value),expires);
  }
  if(bindings){
    db.exec('CREATE TABLE project_bindings(id TEXT PRIMARY KEY,parent_grant TEXT NOT NULL,project TEXT NOT NULL,agent TEXT NOT NULL,expires_ms INTEGER NOT NULL,created_ms INTEGER NOT NULL,revoked_ms INTEGER)');
    db.prepare('INSERT INTO project_bindings VALUES(?,?,?,?,?,?,NULL)').run('11111111-1111-4111-8111-111111111111',grantId,'jarvis','lucy',expires,Date.now());
    db.prepare('INSERT INTO project_bindings VALUES(?,?,?,?,?,?,NULL)').run('22222222-2222-4222-8222-222222222222','other-family','secret-project','mast',expires,Date.now());
  }
  const principal={principal:RELAY_OWNER,grantId,accessHash,scopes:scope.split(' ')};
  const rpc=(call=status,p=principal)=>relayRpc(ctx,s.env,p,call);
  const http=(call=status,headerName=call.params.name)=>s.request('/relay/mcp',{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':RELAY_VERSION,'Mcp-Method':call.method,'Mcp-Name':headerName},body:JSON.stringify({jsonrpc:'2.0',id:1,...call})});
  return {...s,ctx,db,principal,rpc,http,grantId,accessHash};
}
function readOnly(s){
  const exec=s.ctx.storage.sql.exec.bind(s.ctx.storage.sql),queries=[];
  s.ctx.storage.sql.exec=(q,...a)=>{queries.push(q);assert.match(q,/^SELECT\b/i,'Readiness must execute only SELECT');return exec(q,...a);};
  s.ctx.storage.setAlarm=()=>{throw Error('Unexpected alarm');};
  s.ctx.storage.put=()=>{throw Error('Unexpected write');};
  const before=s.db.prepare('SELECT total_changes() AS n').get().n;
  return ()=>{assert.equal(s.db.prepare('SELECT total_changes() AS n').get().n,before);assert.ok(queries.length);};
}

test('closed project gates still expose owner status; direct and full HTTP reads are mutation-free and family-local',async t=>{
  const s=await setup(t);
  const catalog=await s.rpc({method:'tools/list',params:{_meta:meta}});
  assert.deepEqual(catalog.tools.filter(x=>x.name.startsWith('relay_project_')).map(x=>x.name),['relay_project_binding_status']);
  const unchanged=readOnly(s);
  const result=await s.rpc();assert.equal(result.isError,false);
  assert.equal(result.structuredContent.parentGrantId,s.grantId);
  assert.deepEqual(result.structuredContent.bindings.map(b=>[b.project,b.agent]),[['jarvis','lucy']]);
  assert.equal(Object.keys(result.structuredContent.bindings[0]).sort().join(','),'agent,bindingId,expiresAt,project,revokedAt');
  const response=await s.http();assert.equal(response.status,200);
  assert.deepEqual((await response.json()).result.structuredContent,result.structuredContent);
  unchanged();
});

test('another live owner OAuth family sees only its own bindings',async t=>{
  const s=await setup(t),accessHash=await hash('3'.repeat(64));
  const grant=JSON.parse(s.db.prepare("SELECT value FROM relay_oauth WHERE category='grant'").get().value);
  s.db.prepare('INSERT INTO relay_oauth VALUES(?,?,?,?)').run('grant:other-family','grant',JSON.stringify(grant),grant.expiresAt);
  s.db.prepare('INSERT INTO relay_oauth VALUES(?,?,?,?)').run('access:'+accessHash,'access',JSON.stringify({grantId:'other-family',resource:grant.resource,scope:grant.scope,client_id:grant.client_id}),grant.expiresAt);
  const unchanged=readOnly(s);
  const result=await s.rpc(status,{...s.principal,grantId:'other-family',accessHash});
  assert.equal(result.structuredContent.parentGrantId,'other-family');
  assert.deepEqual(result.structuredContent.bindings.map(b=>b.project),['secret-project']);
  assert.ok(!JSON.stringify(result).includes('lucy'));unchanged();
});

test('absent binding table is successful empty inspection without schema creation or OAuth cleanup',async t=>{
  const s=await setup(t,{bindings:false});
  s.db.prepare('INSERT INTO relay_oauth VALUES(?,?,?,?)').run('expired-row','session','{}',1);
  const before=s.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(),unchanged=readOnly(s);
  const result=await (await s.http()).json();assert.deepEqual(result.result.structuredContent,{parentGrantId:s.grantId,bindings:[]});
  assert.deepEqual(s.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(),before);
  assert.ok(s.db.prepare("SELECT key FROM relay_oauth WHERE key='expired-row'").get());unchanged();
});

test('wrong principal/family/scope, expired token/grant, revoked grant and owner gate fail closed without writes',async t=>{
  for(const mode of ['principal','family','scope','token-expiry','grant-expiry','absolute-expiry','revoked','owner-disabled']) {
    await t.test(mode,async t=>{
      const s=await setup(t);const p={...s.principal};
      if(mode==='principal')p.principal='mast';
      if(mode==='family')p.grantId='other-family';
      if(mode==='scope')s.db.prepare("UPDATE relay_oauth SET value=json_set(value,'$.scope','relay:read') WHERE category='access'").run();
      if(mode==='token-expiry')s.db.prepare("UPDATE relay_oauth SET expires_at=1 WHERE category='access'").run();
      if(mode==='grant-expiry')s.db.prepare("UPDATE relay_oauth SET expires_at=1 WHERE category='grant'").run();
      if(mode==='absolute-expiry')s.db.prepare("UPDATE relay_oauth SET value=json_set(value,'$.expiresAt',1) WHERE category='grant'").run();
      if(mode==='revoked')s.db.prepare("UPDATE relay_oauth SET value=json_set(value,'$.revoked',json('true')) WHERE category='grant'").run();
      if(mode==='owner-disabled')s.env.RELAY_OWNER_ENABLED='false';
      const unchanged=readOnly(s);await assert.rejects(s.rpc(status,p));
      if(!['principal','family'].includes(mode)){const r=await s.http();const v=await r.json();assert.ok(r.status!==200||v.error);assert.ok(!JSON.stringify(v).includes('secret-project'));}
      // Principal/owner checks may deny before the first SQL read.
      if(!['principal','owner-disabled'].includes(mode))unchanged();
    });
  }
});

test('malformed/unreadable OAuth or binding storage never reports successful absence',async t=>{
  for(const mode of ['oauth-json','oauth-missing','oauth-client','binding-columns','binding-row','binding-view','read-error']) {
    await t.test(mode,async t=>{
      const s=await setup(t);
      if(mode==='oauth-json')s.db.prepare("UPDATE relay_oauth SET value='{' WHERE category='access'").run();
      if(mode==='oauth-client')s.db.prepare("UPDATE relay_oauth SET value=json_remove(value,'$.client_id')").run();
      if(mode==='oauth-missing')s.db.exec('DROP TABLE relay_oauth');
      if(mode==='binding-columns')s.db.exec('DROP TABLE project_bindings; CREATE TABLE project_bindings(id TEXT)');
      if(mode==='binding-row')s.db.prepare("UPDATE project_bindings SET expires_ms='bad' WHERE parent_grant=?").run(s.grantId);
      if(mode==='binding-view')s.db.exec('DROP TABLE project_bindings; CREATE VIEW project_bindings AS SELECT 1 AS id');
      const unchanged=readOnly(s);
      if(mode==='read-error'){const exec=s.ctx.storage.sql.exec;s.ctx.storage.sql.exec=(q,...a)=>{if(q.includes('FROM project_bindings'))throw Error('unreadable');return exec(q,...a);};}
      await assert.rejects(s.rpc());const r=await s.http(),v=await r.json();assert.ok(r.status!==200||v.error);assert.ok(!v.result);unchanged();
    });
  }
});

test('status accepts no selectors; all project participation, writes and callback activation remain closed',async t=>{
  const s=await setup(t);
  for(const args of [{parentGrantId:'other-family'},{project:'secret-project'},{agent:'mast'},{confirm:true}])await assert.rejects(s.rpc({...status,params:{...status.params,arguments:args}}));
  const mismatch=await s.http({...status,params:{...status.params,name:'relay_project_binding_register',arguments:{}}},'relay_project_binding_status');
  assert.equal(mismatch.status,400);
  const before=s.db.prepare('SELECT * FROM project_bindings ORDER BY id').all();
  for(const tool of [...projectAdminTools,...projectParticipationTools]) await assert.rejects(s.rpc({...status,params:{...status.params,name:tool.name,arguments:{}}}),/not activated/);
  const events=await s.rpc({method:'events/list',params:{_meta:meta}});assert.ok(!events.events.some(e=>e.name==='relay.project.message.created'));
  await assert.rejects(s.rpc({method:'events/subscribe',params:{_meta:meta,name:'relay.project.message.created',arguments:{project:'jarvis',bindingId:before[0].id},delivery:{mode:'webhook',url:'https://callback.example.test',secret:'whsec_'+Buffer.alloc(32,1).toString('base64')}}}));
  assert.deepEqual(s.db.prepare('SELECT * FROM project_bindings ORDER BY id').all(),before);
});

test('revocation after HTTP authentication is rechecked before metadata read',async t=>{
  const s=await setup(t),hub=s.object('jarvis-shared-v2').hub,fetch=hub.fetch.bind(hub);
  hub.fetch=async request=>{
    if(new URL(request.url).pathname==='/internal/relay/rpc')s.db.prepare("UPDATE relay_oauth SET value=json_set(value,'$.revoked',json('true')) WHERE category='grant'").run();
    return fetch(request);
  };
  const response=await s.http(),value=await response.json();
  assert.ok(value.error);assert.ok(!value.result);assert.ok(!JSON.stringify(value).includes(s.grantId));
});
