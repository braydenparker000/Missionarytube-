import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayFixture} from './relay-fixture.js';
import {relayOAuthStore} from '../backend/relay-oauth.js';
import {relayOwnerRpc,relayOwnerStore} from '../backend/relay-owner.js';
import {relayOwnerTools} from '../backend/relay-owner-tools.js';
import {relayRpc} from '../backend/relay-connector.js';
import {relayEventSchema,enqueueRelayOwnerMessage,relaySubscribe,drainRelayOutbox} from '../backend/relay-events.js';
import {sharedStore,SHARED_OBJECT} from '../backend/shared.js';
import {RELAY_OWNER,RELAY_CALLBACK,RELAY_OWNER_SCOPE,RELAY_OWNER_INBOX,RELAY_OWNER_EVENT,RELAY_EVENT,RELAY_INBOX,random,hash,challenge} from '../backend/relay-common.js';

const toolName='relay_owner_delivery_status';
const subscriptionTool='relay_owner_subscription_status';
const args=ids=>({inbox_id:RELAY_OWNER_INBOX,message_ids:ids});
const receiver=async(_url,init)=>Response.json({challenge:JSON.parse(init.body).challenge});
const accepted=async()=>new Response(null,{status:204});

async function grant(s,scope=RELAY_OWNER_SCOPE){
  const client=random(),grantId=random(),code=random(),access=random(),refresh=random();
  const registry=body=>relayOAuthStore(s.ctx,body).json(),resource=s.env.RELAY_MCP_ORIGIN+'/relay/mcp';
  await registry({op:'put',key:'client:'+client,category:'client',value:{redirect:RELAY_CALLBACK},expiresAt:Date.now()+600000});
  const params={client_id:client,redirect_uri:RELAY_CALLBACK,code_challenge:await challenge(random()),scope};
  await registry({op:'authorize',grantId,codeKey:'code:'+await hash(code),params,resource});
  const accessHash=await hash(access);
  await registry({op:'exchange',key:'code:'+await hash(code),match:{client_id:client,redirect_uri:RELAY_CALLBACK,challenge:params.code_challenge,resource},accessKey:'access:'+accessHash,refreshKey:'refresh:'+await hash(refresh)});
  return {principal:RELAY_OWNER,grantId,scopes:scope.split(' '),accessHash,client,registry};
}
async function fixture(t){
  const s=createRelayFixture({env:{RELAY_OWNER_ENABLED:'true'}});t.after(()=>s.close());
  s.ctx=s.object(SHARED_OBJECT).ctx;s.rows=(q,...v)=>[...s.ctx.storage.sql.exec(q,...v)];
  s.auth=await grant(s);
  relayEventSchema(s.ctx);sharedStore(s.ctx,'/internal/shared/state');
  const pair=await (await relayOwnerStore(s.ctx,s.env,{op:'pair_start',label:'Diagnostic fixture',rate_hash:await hash(random())})).json();
  s.phone=await relayOwnerRpc(s.ctx,s.env,s.auth,'relay_owner_pairing_approve',{request_id:pair.request_id,code:pair.code,access_days:365,confirm:true});
  s.token=pair.device_token;s.tokenHash=await hash(s.token);
  s.read=(ids,auth=s.auth)=>relayOwnerRpc(s.ctx,s.env,auth,toolName,args(ids));
  s.health=(auth=s.auth)=>relayOwnerRpc(s.ctx,s.env,auth,subscriptionTool,{inbox_id:RELAY_OWNER_INBOX});
  s.call=(name,arguments_,auth=s.auth)=>relayRpc(s.ctx,s.env,auth,{method:'tools/call',params:{_meta:{},name,arguments:arguments_}});
  s.send=async(body='Private diagnostic fixture body',id=crypto.randomUUID())=>{
    const response=await relayOwnerStore(s.ctx,s.env,{op:'message',token_hash:s.tokenHash,id,body},enqueueRelayOwnerMessage);
    assert.equal(response.status,201);return (await response.json()).entry;
  };
  s.subscribe=url=>relaySubscribe(s.ctx,s.auth,{name:RELAY_OWNER_EVENT,arguments:{inbox_id:RELAY_OWNER_INBOX},delivery:{mode:'webhook',url:url||'https://receiver.example/private-secret-path',secret:'whsec_'+Buffer.alloc(32,17).toString('base64')},cursor:'relay1:0'},s.env,receiver);
  s.reply=id=>relayOwnerRpc(s.ctx,s.env,s.auth,'relay_owner_reply',{inbox_id:RELAY_OWNER_INBOX,message_id:id,body:'Private fixture reply body'});
  s.snapshot=()=>Object.fromEntries(s.rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(({name})=>[name,s.rows('SELECT * FROM '+name+' ORDER BY rowid')]));
  return s;
}
function assertShape(value,schema){
  assert.equal(schema.additionalProperties,false);
  assert.deepEqual(Object.keys(value).sort(),schema.required.slice().sort());
  assert.deepEqual(Object.keys(schema.properties).sort(),schema.required.slice().sort());
}
function guardWrites(t,s){
  const exec=s.ctx.storage.sql.exec;
  t.mock.method(s.ctx.storage.sql,'exec',function(q,...v){
    assert.doesNotMatch(q,/^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i,'diagnostic reads must not write data: '+q);
    return exec.call(this,q,...v);
  });
}
const forbidden=promise=>assert.rejects(promise,error=>error.code===-32012);

test('owner delivery diagnostic schema is strict, bounded, read-only and uses existing owner capability',async t=>{
  const s=await fixture(t),message=await s.send(),tool=relayOwnerTools.find(x=>x.name===toolName);
  assert.deepEqual(tool.securitySchemes,[{type:'oauth2',scopes:[RELAY_OWNER_SCOPE]}]);
  assert.deepEqual(tool._meta.securitySchemes,tool.securitySchemes);
  assert.deepEqual(tool.annotations,{readOnlyHint:true,destructiveHint:false,openWorldHint:false});
  assertShape(args([message.id]),tool.inputSchema);
  assert.equal(tool.inputSchema.properties.message_ids.minItems,1);
  assert.equal(tool.inputSchema.properties.message_ids.maxItems,50);
  assert.equal(tool.inputSchema.properties.message_ids.uniqueItems,true);
  assert.equal(tool.outputSchema.properties.deliveries.maxItems,50);
  const result=await s.read([message.id]);assertShape(result,tool.outputSchema);
  const delivery=result.deliveries[0];assertShape(delivery,tool.outputSchema.properties.deliveries.items);
  assert.deepEqual(delivery,{message_id:message.id,state:'saved',pending:0,failed:0,callbackAcceptedAt:null,retryable:false,retryAfter:null,callbackAccepted:false,replySaved:false});
  for(const entryTool of ['relay_owner_list_pending','relay_owner_read_conversation','relay_owner_reply']){
    const schema=relayOwnerTools.find(x=>x.name===entryTool).outputSchema;
    const entry=schema.properties.messages?.items||schema.properties.message||schema.properties.entry;
    assert.equal(Object.hasOwn(entry.properties,'delivery'),false,'existing entry schema is unchanged');
  }
});

test('diagnostic rejects malformed, duplicate, oversize, public, foreign and reply IDs without writes',async t=>{
  const s=await fixture(t),message=await s.send(),reply=await s.reply(message.id);
  const publicId=crypto.randomUUID(),foreignId=crypto.randomUUID();
  sharedStore(s.ctx,'/internal/shared/message',{id:publicId,body:'Public fixture body'});
  s.rows("INSERT INTO relay_owner_entries(id,kind,body,created_at,principal,device_id,authentication_source) VALUES(?,'user',?,?,?,?,?)",foreignId,'Foreign fixture body',new Date().toISOString(),'github:999',crypto.randomUUID(),'owner-device-session');
  const before=s.snapshot();guardWrites(t,s);
  for(const ids of [undefined,null,'id',[],['bad'],[null],[message.id.toUpperCase()],[message.id,message.id],Array.from({length:51},()=>crypto.randomUUID())]){
    await assert.rejects(s.read(ids),error=>error.data?.status===400,JSON.stringify(ids));
  }
  for(const invalid of [publicId,foreignId,reply.entry.id,crypto.randomUUID()]){
    await assert.rejects(s.read([message.id,invalid]),error=>error.data?.status===404);
  }
  for(const extra of ['body','callback','principal','cursor','limit']){
    await assert.rejects(relayOwnerRpc(s.ctx,s.env,s.auth,toolName,{...args([message.id]),[extra]:'forbidden'}));
  }
  await forbidden(relayOwnerRpc(s.ctx,s.env,s.auth,toolName,{...args([message.id]),inbox_id:'brayden-relay'}));
  assert.deepEqual(s.snapshot(),before);
});

test('diagnostic checks live owner scope and token without broadening public authorization',async t=>{
  const s=await fixture(t),message=await s.send(),ordinary=await grant(s,'relay:read relay:reply relay:events');
  const before=s.snapshot();guardWrites(t,s);
  for(const principal of [ordinary,{...ordinary,scopes:[...ordinary.scopes,RELAY_OWNER_SCOPE]},{...s.auth,principal:'github:999'},{...s.auth,accessHash:random()},{...s.auth,scopes:[]}])await forbidden(s.read([message.id],principal));
  const stepUp=await s.call(toolName,args([message.id]),ordinary);
  assert.equal(stepUp.isError,true);assert.equal(stepUp.structuredContent,undefined);
  assert.match(stepUp._meta['mcp/www_authenticate'][0],/relay:owner/);
  assert.deepEqual(s.snapshot(),before);
});

test('diagnostic revalidates revoked or expired authorization before reading private evidence',async t=>{
  for(const mode of ['revoked','narrowed','access-expired','grant-expired','between-checks']){
    const s=await fixture(t),message=await s.send();
    const key=(mode==='access-expired'?'access:'+s.auth.accessHash:'grant:'+s.auth.grantId);
    const change=()=>{
      if(mode.endsWith('expired'))s.rows('UPDATE relay_oauth SET expires_at=? WHERE key=?',Date.now()-1,key);
      else {const value=JSON.parse(s.rows('SELECT value FROM relay_oauth WHERE key=?',key)[0].value);if(mode==='narrowed')value.scope='relay:read';else value.revoked=true;s.rows('UPDATE relay_oauth SET value=? WHERE key=?',JSON.stringify(value),key);}
    };
    if(mode==='between-checks'){
      const transaction=s.ctx.storage.transactionSync.bind(s.ctx.storage);let once=true;
      s.ctx.storage.transactionSync=fn=>{if(once){once=false;change();}return transaction(fn);};
    }else change();
    const entries=s.rows('SELECT * FROM relay_owner_entries'),events=s.rows('SELECT * FROM relay_events');
    await forbidden(s.read([message.id]));
    assert.deepEqual(s.rows('SELECT * FROM relay_owner_entries'),entries);assert.deepEqual(s.rows('SELECT * FROM relay_events'),events);
  }
});

test('diagnostic returns exact ordered maximum-size batches and never writes messages, events, outbox, subscriptions or sessions',async t=>{
  const s=await fixture(t);await s.subscribe();const ids=[];
  for(let i=0;i<50;i++)ids.push((await s.send('Private fixture '+i)).id);
  const before=s.snapshot();guardWrites(t,s);
  for(const requested of [ids,ids.slice().reverse()]){
    const result=await s.call(toolName,args(requested));
    assert.equal(result.isError,false);assert.equal(result.content.length,1);
    assert.deepEqual(result.structuredContent.deliveries.map(x=>x.message_id),requested);
    assert.ok(result.structuredContent.deliveries.every(x=>x.state==='queued'&&x.pending===1&&!x.replySaved&&!x.callbackAccepted));
    assert.ok(JSON.stringify(result).length<35000,'maximum batch stays bounded');
  }
  assert.deepEqual(s.snapshot(),before,'every persisted table remains byte-for-byte equivalent');
});

test('callback acceptance remains independent of reply_saved and queued/failed replacement deliveries',async t=>{
  const s=await fixture(t),sub=await s.subscribe(),message=await s.send('Sensitive fixture body');
  await drainRelayOutbox(s.ctx,s.env,accepted);
  const initial=(await s.read([message.id])).deliveries[0];
  assert.equal(initial.callbackAccepted,true);assert.equal(initial.replySaved,false);assert.equal(initial.state,'callback_accepted');assert.ok(Date.parse(initial.callbackAcceptedAt));
  const second=await s.subscribe('https://receiver.example/second-private-callback');
  const queued=(await s.read([message.id])).deliveries[0];assert.equal(queued.state,'queued');assert.equal(queued.callbackAccepted,true);assert.equal(queued.pending,1);
  s.rows("UPDATE relay_outbox SET status='failed',attempts=6,last_error='http_503' WHERE subscription_id=?",second.id);
  s.rows("UPDATE relay_subscriptions SET state='delivery_failed' WHERE id=?",second.id);
  const failed=(await s.read([message.id])).deliveries[0];assert.equal(failed.state,'delivery_failed');assert.equal(failed.callbackAccepted,true);assert.equal(failed.failed,1);assert.equal(failed.retryable,true);
  await s.reply(message.id);const before=s.snapshot();guardWrites(t,s);
  const delivery=(await s.read([message.id])).deliveries[0];
  assert.equal(delivery.state,'reply_saved');assert.equal(delivery.callbackAccepted,true);assert.equal(delivery.replySaved,true);
  assert.equal(delivery.callbackAcceptedAt,initial.callbackAcceptedAt);assert.equal(delivery.failed,1);assert.equal(delivery.retryable,false);assert.equal(delivery.retryAfter,null);
  for(const secret of ['Sensitive fixture body','Private fixture reply body',s.token,s.tokenHash,sub.id,second.id,s.auth.grantId,'receiver.example','whsec_','http_503',s.phone.device.id])assert.ok(!JSON.stringify(delivery).includes(secret));
  assert.deepEqual(s.snapshot(),before);
});

test('timestamp-less receipt and reply without callback report honest independent facts',async t=>{
  const s=await fixture(t),acceptedMessage=await s.send(),replyOnly=await s.send();
  const event=s.rows('SELECT seq FROM relay_events WHERE message_id=?','owner:'+acceptedMessage.id)[0];
  s.rows('INSERT INTO relay_delivery_receipts VALUES(?,0)',event.seq);
  await s.reply(acceptedMessage.id);await s.reply(replyOnly.id);
  const before=s.snapshot();guardWrites(t,s);
  const [acceptedDelivery,replyDelivery]=(await s.read([acceptedMessage.id,replyOnly.id])).deliveries;
  assert.equal(acceptedDelivery.state,'reply_saved');assert.equal(acceptedDelivery.callbackAccepted,true);assert.equal(acceptedDelivery.callbackAcceptedAt,null);assert.equal(acceptedDelivery.replySaved,true);
  assert.equal(replyDelivery.state,'reply_saved');assert.equal(replyDelivery.callbackAccepted,false);assert.equal(replyDelivery.callbackAcceptedAt,null);assert.equal(replyDelivery.replySaved,true);
  assert.deepEqual(s.snapshot(),before);
});

test('diagnostic gate stays closed when owner or MCP functionality is disabled',async t=>{
  for(const field of ['RELAY_OWNER_ENABLED','RELAY_MCP_ENABLED']){
    const s=await fixture(t),message=await s.send(),before=s.snapshot();s.env[field]='false';guardWrites(t,s);
    await forbidden(s.read([message.id]));assert.deepEqual(s.snapshot(),before);
  }
});

test('subscription evidence is strict and read-only before an event subscription table exists',async t=>{
  const s=await fixture(t),tool=relayOwnerTools.find(x=>x.name===subscriptionTool);
  s.rows('DROP TABLE relay_subscriptions');const before=s.snapshot();guardWrites(t,s);
  const result=await s.health();assertShape(result,tool.outputSchema);
  assert.deepEqual(tool.annotations,{readOnlyHint:true,destructiveHint:false,openWorldHint:false});
  assert.deepEqual(tool.securitySchemes,[{type:'oauth2',scopes:[RELAY_OWNER_SCOPE]}]);
  assertShape({inbox_id:RELAY_OWNER_INBOX},tool.inputSchema);
  const {observedAt,...status}=result;assert.ok(Date.parse(observedAt));
  assert.deepEqual(status,{inbox_id:RELAY_OWNER_INBOX,active:0,unfilteredActive:0,filteredActive:0,deliveryFailed:0,expired:0,unauthorized:0,nextActiveExpiryAt:null,visibility:'private'});
  assert.deepEqual(s.snapshot(),before,'reading empty subscription evidence does not create event state');
});

test('subscription evidence distinguishes the absent and expired states hidden by identical saved-message evidence',async t=>{
  const s=await fixture(t),message=await s.send(),absent=(await s.read([message.id])).deliveries[0];
  assert.equal((await s.health()).active,0);assert.equal((await s.health()).expired,0);
  const sub=await s.subscribe();assert.equal((await s.health()).unfilteredActive,1);
  s.rows('UPDATE relay_subscriptions SET expires_ms=? WHERE id=?',Date.now()-1,sub.id);
  const before=s.snapshot();guardWrites(t,s);
  assert.deepEqual((await s.read([message.id])).deliveries[0],absent);
  const health=await s.health();assert.equal(health.active,0);assert.equal(health.expired,1);assert.equal(health.nextActiveExpiryAt,null);
  assert.deepEqual(s.snapshot(),before);
});

test('private subscription evidence separates filters, excludes public subscriptions and never exposes identities or secrets',async t=>{
  const s=await fixture(t),plain=await s.subscribe('https://receiver.example/plain-private-path');
  const filtered=await relaySubscribe(s.ctx,s.auth,{name:RELAY_OWNER_EVENT,arguments:{inbox_id:RELAY_OWNER_INBOX,message_contains:'Secret diagnostic filter'},delivery:{mode:'webhook',url:'https://receiver.example/filtered-private-path',secret:'whsec_'+Buffer.alloc(32,23).toString('base64')},cursor:'relay1:0'},s.env,receiver);
  const publicAuth=await grant(s,'relay:events');
  await relaySubscribe(s.ctx,publicAuth,{name:RELAY_EVENT,arguments:{inbox_id:RELAY_INBOX},delivery:{mode:'webhook',url:'https://receiver.example/public-path',secret:'whsec_'+Buffer.alloc(32,24).toString('base64')},cursor:'relay1:0'},s.env,receiver);
  const before=s.snapshot();guardWrites(t,s);const health=await s.health();
  assert.equal(health.active,2);assert.equal(health.unfilteredActive,1);assert.equal(health.filteredActive,1);
  assert.equal(health.nextActiveExpiryAt,new Date(Math.min(...s.rows('SELECT expires_ms FROM relay_subscriptions WHERE name=?',RELAY_OWNER_EVENT).map(x=>x.expires_ms))).toISOString());
  for(const secret of [plain.id,filtered.id,s.auth.grantId,publicAuth.grantId,s.token,s.tokenHash,s.phone.device.id,'receiver.example','whsec_','Secret diagnostic filter','brayden-relay'])assert.ok(!JSON.stringify(health).includes(secret));
  assert.deepEqual(s.snapshot(),before);
});

test('paused, expired and unauthorized subscriptions cannot imply an active private responder',async t=>{
  const s=await fixture(t),active=await s.subscribe('https://receiver.example/active');
  const paused=await s.subscribe('https://receiver.example/paused'),expired=await s.subscribe('https://receiver.example/expired'),narrowed=await s.subscribe('https://receiver.example/narrowed');
  const ordinary=await grant(s,'relay:read');
  s.rows("UPDATE relay_subscriptions SET state='delivery_failed' WHERE id=?",paused.id);
  s.rows('UPDATE relay_subscriptions SET expires_ms=? WHERE id=?',Date.now()-1,expired.id);
  s.rows('UPDATE relay_subscriptions SET grant_id=? WHERE id=?',ordinary.grantId,narrowed.id);
  const before=s.snapshot();guardWrites(t,s);const {observedAt,...health}=await s.health();
  assert.deepEqual(health,{inbox_id:RELAY_OWNER_INBOX,active:1,unfilteredActive:1,filteredActive:0,deliveryFailed:1,expired:1,unauthorized:1,nextActiveExpiryAt:new Date(s.rows('SELECT expires_ms FROM relay_subscriptions WHERE id=?',active.id)[0].expires_ms).toISOString(),visibility:'private'});
  assert.deepEqual(s.snapshot(),before);
});

test('current subscription loss does not erase historical callback acceptance',async t=>{
  const s=await fixture(t),sub=await s.subscribe(),message=await s.send();await drainRelayOutbox(s.ctx,s.env,accepted);
  const received=(await s.read([message.id])).deliveries[0];assert.equal(received.callbackAccepted,true);
  s.rows('DELETE FROM relay_subscriptions WHERE id=?',sub.id);
  const before=s.snapshot();guardWrites(t,s);
  assert.equal((await s.health()).active,0);assert.deepEqual((await s.read([message.id])).deliveries[0],received);
  assert.deepEqual(s.snapshot(),before);
});

test('subscription diagnostics reject public scopes, foreign identity, disabled gates and extra arguments without writes',async t=>{
  const s=await fixture(t),ordinary=await grant(s,'relay:read relay:reply relay:events'),before=s.snapshot();guardWrites(t,s);
  for(const auth of [ordinary,{...ordinary,scopes:[RELAY_OWNER_SCOPE]},{...s.auth,principal:'github:999'},{...s.auth,accessHash:random()}])await forbidden(s.health(auth));
  const challenge=await s.call(subscriptionTool,{inbox_id:RELAY_OWNER_INBOX},ordinary);assert.equal(challenge.isError,true);assert.equal(challenge.structuredContent,undefined);
  for(const input of [{inbox_id:RELAY_INBOX},{},{inbox_id:RELAY_OWNER_INBOX,message_ids:[]},{inbox_id:RELAY_OWNER_INBOX,callback:'https://receiver.example'}])await assert.rejects(relayOwnerRpc(s.ctx,s.env,s.auth,subscriptionTool,input));
  for(const gate of ['RELAY_OWNER_ENABLED','RELAY_MCP_ENABLED']){s.env[gate]='false';await forbidden(s.health());s.env[gate]='true';}
  assert.deepEqual(s.snapshot(),before);
});

test('subscription diagnostics revalidate expiry, revocation and scope narrowing inside the read transaction',async t=>{
  for(const mode of ['revoked','narrowed','access-expired','grant-expired','between-checks']){
    const s=await fixture(t);await s.subscribe();
    const key=mode==='access-expired'?'access:'+s.auth.accessHash:'grant:'+s.auth.grantId;
    const change=()=>{
      if(mode.endsWith('expired'))s.rows('UPDATE relay_oauth SET expires_at=? WHERE key=?',Date.now()-1,key);
      else {const value=JSON.parse(s.rows('SELECT value FROM relay_oauth WHERE key=?',key)[0].value);if(mode==='narrowed')value.scope='relay:read';else value.revoked=true;s.rows('UPDATE relay_oauth SET value=? WHERE key=?',JSON.stringify(value),key);}
    };
    if(mode==='between-checks'){const transaction=s.ctx.storage.transactionSync.bind(s.ctx.storage);s.ctx.storage.transactionSync=fn=>{change();return transaction(fn);};}
    else change();
    await forbidden(s.health());
  }
});
