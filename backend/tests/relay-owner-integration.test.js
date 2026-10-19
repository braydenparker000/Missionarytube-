import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayFixture} from './relay-fixture.js';
import {relayOAuthStore} from '../relay-oauth.js';
import {relayRpc} from '../relay-connector.js';
import {relayOwnerRpc} from '../relay-owner.js';
import {relayOwnerTools} from '../relay-owner-tools.js';
import {relaySubscribe,drainRelayOutbox} from '../relay-events.js';
import {sharedStore,SHARED_OBJECT} from '../shared.js';
import {PRIMARY_SITE} from '../origins.js';
import {RELAY_OWNER,RELAY_CALLBACK,RELAY_SCOPES,RELAY_PUBLIC_SCOPES,RELAY_OWNER_SCOPE,RELAY_OWNER_INBOX,RELAY_OWNER_EVENT,RELAY_INBOX,RELAY_EVENT,RELAY_VERSION,random,hash,challenge} from '../relay-common.js';

async function grant(s,scope=RELAY_PUBLIC_SCOPES.join(' ')){
  const ctx=s.object(SHARED_OBJECT).ctx,client=random(),grantId=random(),verifier=random(),code=random(),access=random(),refresh=random();
  const registry=b=>relayOAuthStore(ctx,b).json(),resource=s.env.RELAY_MCP_ORIGIN+'/relay/mcp';
  await registry({op:'put',key:'client:'+client,category:'client',value:{redirect:RELAY_CALLBACK},expiresAt:Date.now()+600000});
  const params={client_id:client,redirect_uri:RELAY_CALLBACK,code_challenge:await challenge(verifier),scope};
  await registry({op:'authorize',grantId,codeKey:'code:'+await hash(code),params,resource});
  const accessHash=await hash(access);
  await registry({op:'exchange',key:'code:'+await hash(code),match:{client_id:client,redirect_uri:RELAY_CALLBACK,challenge:params.code_challenge,resource},accessKey:'access:'+accessHash,refreshKey:'refresh:'+await hash(refresh)});
  return {principal:RELAY_OWNER,grantId,scopes:scope.split(' '),accessHash,access,refresh,client,registry,resource};
}
function fixture(t){
  const s=createRelayFixture({env:{RELAY_OWNER_ENABLED:'true'}});t.after(()=>s.close());
  s.ctx=s.object(SHARED_OBJECT).ctx;
  s.rows=(q,...v)=>[...s.ctx.storage.sql.exec(q,...v)];
  s.phone=(path,body,token)=>s.request('/relay/owner'+path,{method:body===undefined?'GET':'POST',headers:{Origin:PRIMARY_SITE,...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  s.rpcResponse=(auth,method,p={})=>s.request('/relay/mcp',{method:'POST',headers:{Authorization:'Bearer '+auth.access,Accept:'application/json, text/event-stream','Content-Type':'application/json','MCP-Protocol-Version':RELAY_VERSION,'Mcp-Method':method,...(method==='tools/call'?{'Mcp-Name':p.name}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{...p,_meta:{'io.modelcontextprotocol/protocolVersion':RELAY_VERSION,'io.modelcontextprotocol/clientCapabilities':{}}}})});
  s.rpc=(auth,method,p={})=>s.rpcResponse(auth,method,p).then(r=>r.json());
  return s;
}
async function pair(s,auth,label){
  const response=await s.phone('/pair/start',{label});assert.equal(response.status,201);
  const pending=await response.json();
  const inspect=await relayOwnerRpc(s.ctx,s.env,auth,'relay_owner_pairing_inspect',{code:pending.code});
  assert.equal(inspect.request_id,pending.request_id);
  await relayOwnerRpc(s.ctx,s.env,auth,'relay_owner_pairing_approve',{request_id:pending.request_id,code:pending.code,access_days:365,confirm:true});
  const status=await (await s.phone('/pair/status',{request_id:pending.request_id},pending.device_token)).json();
  assert.equal(status.status,'approved');return {...pending,device:status.device};
}
const receiver=async (_url,init)=>{const body=JSON.parse(init.body);return body.type==='verification'?Response.json({challenge:body.challenge}):new Response(null,{status:204});};
const subscription=(name,inbox_id,url)=>({name,arguments:{inbox_id},delivery:{mode:'webhook',url,secret:'whsec_'+Buffer.alloc(32,17).toString('base64')},cursor:'relay1:0'});

test('owner schemas are discoverable, capability is explicit and old grants never expand',async t=>{
  const s=fixture(t),ordinary=await grant(s),owner=await grant(s,RELAY_OWNER_SCOPE);
  const unauth=await s.request('/relay/mcp');assert.match(unauth.headers.get('WWW-Authenticate'),/scope="relay:read relay:reply relay:events"/);assert.doesNotMatch(unauth.headers.get('WWW-Authenticate'),/relay:owner/);
  const publicTools=(await s.rpc(ordinary,'tools/list')).result.tools;
  assert.equal(publicTools.length,4+relayOwnerTools.length);
  const ownerTools=publicTools.filter(x=>x.name.startsWith('relay_owner_'));
  assert.equal(ownerTools.length,relayOwnerTools.length);
  assert.deepEqual(ownerTools.map(tool=>tool.name),relayOwnerTools.map(tool=>tool.name));
  for(const tool of ownerTools){
    assert.deepEqual(tool.securitySchemes,[{type:'oauth2',scopes:[RELAY_OWNER_SCOPE]}]);
    assert.deepEqual(tool._meta.securitySchemes,tool.securitySchemes);
    assert.ok(tool.inputSchema&&tool.outputSchema);
  }
  const ownerCatalog=(await s.rpc(owner,'tools/list')).result.tools;
  assert.equal(ownerCatalog.length,2+relayOwnerTools.length);
  assert.deepEqual(ownerCatalog.map(tool=>tool.name).sort(),['relay_event_access_status',...relayOwnerTools.map(tool=>tool.name),'relay_project_binding_status'].sort());
  assert.equal(ownerCatalog.find(tool=>tool.name==='relay_project_binding_status').annotations.readOnlyHint,true);
  assert.deepEqual((await s.rpc(ordinary,'events/list')).result.events.map(x=>x.name),[RELAY_EVENT]);
  assert.deepEqual((await s.rpc(owner,'events/list')).result.events.map(x=>x.name),[RELAY_OWNER_EVENT]);
  await assert.rejects(relayOwnerRpc(s.ctx,s.env,ordinary,'relay_owner_devices_list',{}),e=>e.code===-32012);
  const widened=await ordinary.registry({op:'exchange',key:'refresh:'+await hash(ordinary.refresh),match:{client_id:ordinary.client,resource:ordinary.resource},scope:ordinary.scopes.join(' ')+' '+RELAY_OWNER_SCOPE,accessKey:'access:'+await hash(random()),refreshKey:'refresh:'+await hash(random())});
  assert.deepEqual(widened,{});
  const stored=s.rows('SELECT value FROM relay_oauth WHERE key=?','grant:'+ordinary.grantId)[0];assert.equal(JSON.parse(stored.value).scope,ordinary.scopes.join(' '));
  s.env.RELAY_OWNER_ENABLED='false';
  assert.equal((await s.rpc(owner,'tools/list')).result.tools.length,1);
  assert.equal((await s.rpc(ordinary,'tools/list')).result.tools.length,4);
  assert.deepEqual((await s.rpc(owner,'events/list')).result.events,[]);
  const disabled=await s.rpc(ordinary,'tools/call',{name:'relay_owner_devices_list',arguments:{}});
  assert.equal(disabled.error.code,-32012);assert.equal(disabled.result,undefined);
  assert.equal((await s.phone('/pair/start',{label:'Disabled'})).status,503);
});

test('old public grants get native owner step-up without private reads or owner mutations',async t=>{
  const s=fixture(t),ordinary=await grant(s),owner=await grant(s,RELAY_OWNER_SCOPE),phone=await pair(s,owner,'Fixture approved phone');
  const pending=await (await s.phone('/pair/start',{label:'Fixture pending private label'})).json();
  const id=crypto.randomUUID(),body='Fixture private owner content';
  assert.equal((await s.phone('/messages',{id,body},phone.device_token)).status,201);
  const catalog=JSON.stringify((await s.rpc(ordinary,'tools/list')).result);
  for(const secret of [body,phone.device_token,phone.device.id,pending.label,pending.request_id,pending.code].filter(Boolean))assert.ok(!catalog.includes(secret));
  assert.ok(!catalog.includes('Fixture pending private label'));
  const tables=['relay_owner_pairings','relay_owner_sessions','relay_owner_entries','relay_owner_meta','relay_owner_pair_rates'];
  const snapshot=()=>tables.map(table=>s.rows('SELECT * FROM '+table));
  const before=snapshot();
  const calls=[
    ['relay_owner_pairing_inspect',{code:pending.code}],
    ['relay_owner_pairing_approve',{request_id:pending.request_id,code:pending.code,access_days:365,confirm:true}],
    ['relay_owner_devices_list',{}],
    ['relay_owner_device_revoke',{device_id:phone.device.id}],
    ['relay_owner_list_pending',{inbox_id:RELAY_OWNER_INBOX}],
    ['relay_owner_read_conversation',{inbox_id:RELAY_OWNER_INBOX,message_id:id}],
    ['relay_owner_delivery_status',{inbox_id:RELAY_OWNER_INBOX,message_ids:[id]}],
    ['relay_owner_reply',{inbox_id:RELAY_OWNER_INBOX,message_id:id,body:'Unconsented private reply'}]
  ];
  const expected=`Bearer resource_metadata="${s.env.RELAY_MCP_ORIGIN}/.well-known/oauth-protected-resource/relay/mcp", scope="${[...RELAY_PUBLIC_SCOPES,RELAY_OWNER_SCOPE].join(' ')}", error="insufficient_scope", error_description="Authorize Owner chat access to use this tool"`;
  for(const [name,arguments_] of calls){
    const response=await s.rpc(ordinary,'tools/call',{name,arguments:arguments_});
    assert.equal(response.error,undefined);
    assert.equal(response.result.resultType,'complete');assert.equal(response.result.isError,true);
    assert.equal(response.result.structuredContent,undefined);
    assert.deepEqual(response.result._meta,{'mcp/www_authenticate':[expected]});
    assert.deepEqual(response.result.content,[{type:'text',text:'Authorize Owner chat access to use this tool'}]);
    assert.deepEqual(snapshot(),before,'scope challenge must not approve, create, revoke or write owner state');
    for(const secret of [body,phone.device_token,pending.request_id,pending.code])assert.ok(!JSON.stringify(response).includes(secret));
  }
  const status=await (await s.phone('/pair/status',{request_id:pending.request_id},pending.device_token)).json();
  assert.equal(status.status,'pending');
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_owner_sessions')[0].n,1);
});

test('owner step-up preserves only live verified scopes of a partial public grant',async t=>{
  const s=fixture(t),narrow=await grant(s,'relay:read');
  const catalog=(await s.rpc(narrow,'tools/list')).result.tools;
  assert.equal(catalog.length,3+relayOwnerTools.length);assert.ok(!catalog.some(x=>x.name==='relay_reply'));
  assert.deepEqual((await s.rpc(narrow,'events/list')).result.events,[]);
  const rpc={method:'tools/call',params:{_meta:{},name:'relay_owner_devices_list',arguments:{}}};
  // A claimed scope does not count as an existing permission or bypass the
  // live token/grant check, even through the internal RPC entry point.
  for(const principal of [narrow,{...narrow,scopes:[...RELAY_SCOPES,'account:admin']}]){
    const result=await relayRpc(s.ctx,s.env,principal,rpc);
    assert.equal(result.isError,true);
    const authenticate=result._meta['mcp/www_authenticate'][0];
    assert.match(authenticate,/scope="relay:read relay:owner"/);
    assert.ok(!authenticate.includes('relay:reply'));assert.ok(!authenticate.includes('relay:events'));assert.ok(!authenticate.includes('account:admin'));
  }
  const stored=JSON.parse(s.rows('SELECT value FROM relay_oauth WHERE key=?','grant:'+narrow.grantId)[0].value);
  assert.equal(stored.scope,'relay:read');
});

test('a newly consented full owner grant retains public tools and owner operations',async t=>{
  const s=fixture(t),owner=await grant(s,RELAY_SCOPES.join(' '));
  const ownerCatalog=(await s.rpc(owner,'tools/list')).result.tools;
  assert.equal(ownerCatalog.length,5+relayOwnerTools.length);
  assert.deepEqual(ownerCatalog.map(tool=>tool.name).sort(),['relay_list_pending','relay_read_conversation','relay_reply','relay_event_access_status',...relayOwnerTools.map(tool=>tool.name),'relay_project_binding_status'].sort());
  assert.equal(ownerCatalog.find(tool=>tool.name==='relay_project_binding_status').annotations.readOnlyHint,true);
  assert.deepEqual((await s.rpc(owner,'events/list')).result.events.map(x=>x.name),[RELAY_EVENT,RELAY_OWNER_EVENT]);
  const devices=await s.rpc(owner,'tools/call',{name:'relay_owner_devices_list',arguments:{}});
  assert.equal(devices.result.isError,false);assert.deepEqual(devices.result.structuredContent,{devices:[]});
  const pending=await s.rpc(owner,'tools/call',{name:'relay_owner_list_pending',arguments:{inbox_id:RELAY_OWNER_INBOX}});
  assert.equal(pending.result.isError,false);assert.deepEqual(pending.result.structuredContent.messages,[]);
  const id=crypto.randomUUID();sharedStore(s.ctx,'/internal/shared/message',{id,body:'Fixture public visitor message'});
  const read=await s.rpc(owner,'tools/call',{name:'relay_list_pending',arguments:{inbox_id:RELAY_INBOX}});
  assert.equal(read.result.structuredContent.messages[0].id,id);
  const reply=await s.rpc(owner,'tools/call',{name:'relay_reply',arguments:{inbox_id:RELAY_INBOX,message_id:id,body:'Fixture public answer'}});
  assert.equal(reply.result.isError,false);assert.equal(reply.result.structuredContent.public_inbox,true);
});

test('revoked, rotated or expired tokens/grants cannot discover or invoke owner tools',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  for(const scope of [RELAY_PUBLIC_SCOPES.join(' '),RELAY_OWNER_SCOPE])for(const mode of ['revoked','rotated','access-expired','grant-expired']){
    const s=fixture(t),auth=await grant(s,scope);
    if(mode==='revoked')await auth.registry({op:'revoke',tokenHash:auth.accessHash,client_id:auth.client});
    else if(mode==='rotated')await auth.registry({op:'exchange',key:'refresh:'+await hash(auth.refresh),match:{client_id:auth.client,resource:auth.resource},accessKey:'access:'+await hash(random()),refreshKey:'refresh:'+await hash(random())});
    else now+=mode==='access-expired'?3600000:30*86400000;
    for(const [method,p] of [['tools/list',{}],['tools/call',{name:'relay_owner_devices_list',arguments:{}}]]){
      const response=await s.rpcResponse(auth,method,p);assert.equal(response.status,401);
      assert.deepEqual(await response.json(),{error:'Connect the owner’s Relay account using OAuth'});
      await assert.rejects(relayRpc(s.ctx,s.env,auth,{method,params:{...p,_meta:{}}}),e=>e.code===-32012);
    }
  }
});

test('two phone sessions and private replies stay isolated from all public reads/tools',async t=>{
  const s=fixture(t),owner=await grant(s,RELAY_OWNER_SCOPE),ordinary=await grant(s),a=await pair(s,owner,'Unrestricted phone'),b=await pair(s,owner,'Main phone');
  assert.notEqual(a.device_token,b.device_token);assert.notEqual(a.device.id,b.device.id);
  const id=crypto.randomUUID(),body='Private owner text never goes to public Relay';
  assert.equal((await s.phone('/messages',{id,body,principal:RELAY_OWNER,author_authenticated:true},a.device_token)).status,400);
  const inserted=await s.phone('/messages',{id,body},a.device_token);assert.equal(inserted.status,201);
  const entry=(await inserted.json()).entry;assert.equal(entry.author_authenticated,true);assert.equal(entry.device_id,a.device.id);assert.equal(entry.authentication_source,'owner-device-session');
  const publicState=await sharedStore(s.ctx,'/internal/shared/state').json();assert.ok(!JSON.stringify(publicState).includes(body));
  const publicRead=await relayRpc(s.ctx,s.env,ordinary,{method:'tools/call',params:{_meta:{},name:'relay_read_conversation',arguments:{inbox_id:RELAY_INBOX,message_id:id}}});assert.equal(publicRead.isError,true);
  const publicReply=await relayRpc(s.ctx,s.env,ordinary,{method:'tools/call',params:{_meta:{},name:'relay_reply',arguments:{inbox_id:RELAY_INBOX,message_id:id,body:'Wrong channel'}}});assert.equal(publicReply.isError,true);
  const reply=await s.rpc(owner,'tools/call',{name:'relay_owner_reply',arguments:{inbox_id:RELAY_OWNER_INBOX,message_id:id,body:'Private answer'}});assert.equal(reply.result.structuredContent.visibility,'private');
  const both=await (await s.phone('/messages',undefined,b.device_token)).json();assert.equal(both.messages.length,2);assert.equal(both.messages[1].body,'Private answer');
  const anonymous=await s.phone('/messages');assert.equal(anonymous.status,401);
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM shared_entries WHERE id=? OR reply_to=?',id,id)[0].n,0);
  assert.equal((await s.phone('/devices/revoke',{device_id:a.device.id},b.device_token)).status,200);
  assert.equal((await s.phone('/session',undefined,a.device_token)).status,401);
  assert.equal((await s.phone('/session',undefined,b.device_token)).status,200);
});

test('private event delivery is scoped, metadata-only, replayable and separated from public events',async t=>{
  const s=fixture(t),owner=await grant(s,RELAY_OWNER_SCOPE),ordinary=await grant(s),phone=await pair(s,owner,'Main phone');
  const pub=subscription(RELAY_EVENT,RELAY_INBOX,'https://public.example/callback'),priv=subscription(RELAY_OWNER_EVENT,RELAY_OWNER_INBOX,'https://private.example/callback');
  await assert.rejects(relaySubscribe(s.ctx,ordinary,priv,s.env,receiver),e=>e.code===-32012);
  await relaySubscribe(s.ctx,ordinary,pub,s.env,receiver);await relaySubscribe(s.ctx,owner,priv,s.env,receiver);
  // IDs can coincide across inboxes without suppressing either event.
  const id=crypto.randomUUID();sharedStore(s.ctx,'/internal/shared/message',{id,body:'Public text'});
  assert.equal((await s.phone('/messages',{id,body:'Private financial and account context'},phone.device_token)).status,201);
  const deliveries=[];await drainRelayOutbox(s.ctx,s.env,async(url,init)=>{deliveries.push({url,payload:JSON.parse(init.body)});return new Response(null,{status:204});});
  assert.equal(deliveries.length,2);
  const privateEvent=deliveries.find(x=>x.url==='https://private.example/callback').payload;
  assert.equal(privateEvent.name,RELAY_OWNER_EVENT);assert.equal(privateEvent.data.author_authenticated,true);assert.equal(privateEvent.data.principal,RELAY_OWNER);assert.equal(privateEvent.data.device_id,phone.device.id);
  assert.ok(!JSON.stringify(privateEvent).includes('financial'));assert.equal(privateEvent.data.body_preview,undefined);
  const publicEvent=deliveries.find(x=>x.url==='https://public.example/callback').payload;assert.equal(publicEvent.name,RELAY_EVENT);assert.equal(publicEvent.data.author_authenticated,false);
  const replay=subscription(RELAY_OWNER_EVENT,RELAY_OWNER_INBOX,'https://replay.example/callback');replay.arguments.message_contains='financial';
  await relaySubscribe(s.ctx,owner,replay,s.env,receiver);const replayed=[];await drainRelayOutbox(s.ctx,s.env,async(url,init)=>{replayed.push({url,payload:JSON.parse(init.body)});return new Response(null,{status:204});});
  assert.equal(replayed.length,1);assert.equal(replayed[0].payload.data.message_id,id);
});

test('owner grant revocation during signing blocks private callback transmission',async t=>{
  const s=fixture(t),owner=await grant(s,RELAY_OWNER_SCOPE),phone=await pair(s,owner,'Main phone');
  await relaySubscribe(s.ctx,owner,subscription(RELAY_OWNER_EVENT,RELAY_OWNER_INBOX,'https://private.example/callback'),s.env,receiver);
  await s.phone('/messages',{id:crypto.randomUUID(),body:'Private pending'},phone.device_token);
  const sign=crypto.subtle.sign.bind(crypto.subtle);t.mock.method(crypto.subtle,'sign',async(...args)=>{await owner.registry({op:'revoke',tokenHash:owner.accessHash,client_id:owner.client});return sign(...args);});
  let transmitted=0;await drainRelayOutbox(s.ctx,s.env,async()=>{transmitted++;return new Response(null,{status:204});});
  assert.equal(transmitted,0);assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscriptions')[0].n,0);
  // Explicitly approved phone access has an independent lifetime and revocation control.
  assert.equal((await s.phone('/session',undefined,phone.device_token)).status,200);
});

test('existing private conversation tool retains exact structured output and adds separate redacted diagnostic text',async t=>{
  const s=fixture(t),owner=await grant(s,RELAY_OWNER_SCOPE),phone=await pair(s,owner,'Diagnostic phone');
  const id=crypto.randomUUID(),body='Secret private conversation text';
  await relaySubscribe(s.ctx,owner,subscription(RELAY_OWNER_EVENT,RELAY_OWNER_INBOX,'https://receiver.example/private-callback-secret'),s.env,receiver);
  assert.equal((await s.phone('/messages',{id,body},phone.device_token)).status,201);
  await drainRelayOutbox(s.ctx,s.env,receiver);
  await relayOwnerRpc(s.ctx,s.env,owner,'relay_owner_reply',{inbox_id:RELAY_OWNER_INBOX,message_id:id,body:'Secret private reply text'});
  const expected=await relayOwnerRpc(s.ctx,s.env,owner,'relay_owner_read_conversation',{inbox_id:RELAY_OWNER_INBOX,message_id:id});
  const evidence=await relayOwnerRpc(s.ctx,s.env,owner,'relay_owner_delivery_status',{inbox_id:RELAY_OWNER_INBOX,message_ids:[id]});
  const tables=['relay_owner_entries','shared_entries','relay_events','relay_owner_event_bodies','relay_outbox','relay_subscriptions','relay_delivery_receipts','relay_owner_sessions','relay_owner_jobs','relay_owner_job_events'];
  const snapshot=()=>tables.map(table=>s.rows('SELECT * FROM '+table));
  const before=snapshot();
  const response=await s.rpc(owner,'tools/call',{name:'relay_owner_read_conversation',arguments:{inbox_id:RELAY_OWNER_INBOX,message_id:id}});
  assert.equal(response.result.isError,false);
  assert.deepEqual(response.result.structuredContent,expected,'cached strict output schema remains valid');
  assert.deepEqual(response.result.content[0],{type:'text',text:JSON.stringify(expected)},'original serialized content is unchanged');
  assert.equal(response.result.content.length,4);
  const block=response.result.content[1];
  const label='Private delivery diagnostics (callback acceptance is transport evidence only): ';
  assert.equal(block.type,'text');assert.ok(block.text.startsWith(label));
  assert.deepEqual(JSON.parse(block.text.slice(label.length)),evidence);
  assert.equal(evidence.deliveries[0].state,'reply_saved');assert.equal(evidence.deliveries[0].replySaved,true);
  assert.equal(evidence.deliveries[0].callbackAccepted,true);assert.ok(Date.parse(evidence.deliveries[0].callbackAcceptedAt));
  for(const secret of [body,'Secret private reply text',phone.device_token,phone.device.id,owner.grantId,owner.access,owner.accessHash,'receiver.example','whsec_'])assert.ok(!block.text.includes(secret));
  const subscriptionBlock=response.result.content[2],subscriptionLabel='Private subscription diagnostics (current subscription evidence only; no host execution proof): ';
  assert.equal(subscriptionBlock.type,'text');assert.ok(subscriptionBlock.text.startsWith(subscriptionLabel));
  const subscriptions=JSON.parse(subscriptionBlock.text.slice(subscriptionLabel.length));
  assert.equal(subscriptions.inbox_id,RELAY_OWNER_INBOX);assert.equal(subscriptions.active,1);assert.equal(subscriptions.unfilteredActive,1);assert.equal(subscriptions.filteredActive,0);assert.ok(Date.parse(subscriptions.observedAt));
  for(const secret of [body,'Secret private reply text',phone.device_token,phone.device.id,owner.grantId,owner.access,owner.accessHash,'receiver.example','whsec_'])assert.ok(!subscriptionBlock.text.includes(secret));
  const jobBlock=response.result.content[3],jobLabel='Private job lifecycle (authenticated server evidence; callback acceptance never establishes execution): ';
  assert.equal(jobBlock.type,'text');assert.ok(jobBlock.text.startsWith(jobLabel));
  const lifecycle=JSON.parse(jobBlock.text.slice(jobLabel.length));
  assert.equal(lifecycle.job_id,id);assert.equal(lifecycle.stage,'outcome_unknown');assert.equal(lifecycle.actionKind,'unclassified');assert.equal(lifecycle.execution,null);
  assert.equal(lifecycle.completion,null);assert.equal(lifecycle.finishedAt,null);assert.equal(lifecycle.failure.code,'completion_unverified');
  for(const secret of [body,'Secret private reply text',phone.device_token,phone.device.id,owner.grantId,owner.access,owner.accessHash,'receiver.example','whsec_'])assert.ok(!jobBlock.text.includes(secret));
  assert.equal(Object.hasOwn(response.result.structuredContent.message,'delivery'),false);
  assert.equal(Object.hasOwn(response.result.structuredContent.reply,'delivery'),false);
  assert.deepEqual(snapshot(),before,'compatibility text never creates a message, reply, event or delivery');
});

test('conversation diagnostic compatibility block rechecks owner authorization before releasing the result',async t=>{
  for(const revokedBefore of [2,3,4]){
  const s=fixture(t),owner=await grant(s,RELAY_OWNER_SCOPE),phone=await pair(s,owner,'Revalidation phone');
  const id=crypto.randomUUID();await s.phone('/messages',{id,body:'Private text behind live authorization'},phone.device_token);
  const transaction=s.ctx.storage.transactionSync.bind(s.ctx.storage);let calls=0;
  s.ctx.storage.transactionSync=fn=>{
    if(++calls===revokedBefore){
      const key='grant:'+owner.grantId,value=JSON.parse(s.rows('SELECT value FROM relay_oauth WHERE key=?',key)[0].value);
      value.revoked=true;s.rows('UPDATE relay_oauth SET value=? WHERE key=?',JSON.stringify(value),key);
    }
    return transaction(fn);
  };
  await assert.rejects(relayRpc(s.ctx,s.env,owner,{method:'tools/call',params:{_meta:{},name:'relay_owner_read_conversation',arguments:{inbox_id:RELAY_OWNER_INBOX,message_id:id}}}),error=>error.code===-32012);
  assert.equal(calls,revokedBefore,'each supplemental diagnostic RPC revalidates inside its own transaction');
  }
});
