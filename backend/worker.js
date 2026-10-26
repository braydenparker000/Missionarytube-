import {boardAgentStore,boardMakimaAuth} from './relay-board-auth.js';
import {agentChatPublic,agentChatStore} from './relay-agent-chat.js';
import {makimaConnector,makimaRpc,makimaChannelStore} from './relay-makima.js';
import {MAKIMA_OBJECT,makimaEnabled,makimaOAuthPolicy} from './relay-makima-policy.js';
import {mastAdapterPublic, mastAdapterStore} from './relay-mast.js';
import {readBoardDraft} from './relay-mast-board.js';
import {connector,oauthStore} from './connector.js';
import {sharedStore,sharedSchema,SHARED_OBJECT,validateSharedRead,readLegacyInboxPage} from './shared.js';
import {syncPublications,importPublicationHint,seedPublicationReconciliation,nextPublicationReconciliationAt,publicationReadNeedsWake} from './publications.js';
import {PRIMARY_SITE,FRONTEND_ORIGINS} from './origins.js';
import {songsterr} from './songsterr.js';
import {guitarSources} from './guitar-sources.js';
import {music} from './music.js';
import {nativeMusic} from './music-upload.js';
import {podcasts} from './podcasts.js';
import {relayConnector,relayRpc} from './relay-connector.js';
import {relayOAuthStore} from './relay-oauth.js';
import {drainRelayOutbox,scheduleRelayAlarm,enqueueRelayOwnerMessage,webhookTransport} from './relay-events.js';
import {reserveRelayCoreWake,releaseRelayCoreWake,assertRelayCoreWake,beginRelayCoreAlarm,abandonRelayCoreAlarm} from './relay-core-alarm.js';
import {relayOwnerPublic,relayOwnerStore,relayOwnerAssistantAttachmentIngress} from './relay-owner.js';
import {RelayError,boundedText,RELAY_OAUTH_OBJECT} from './relay-common.js';
import {projectTransport,projectStore} from './relay-projects.js';
import {claudeChatPublic,claudeChatInternal,CLAUDE_CHAT_OBJECT} from './claude-chat.js';
import {musicCatalogInternal,musicCatalogAlarm,isMusicCatalog,MUSIC_CATALOG_OBJECT} from './music-catalog.js';
const paths = new Set(['/v1/state', '/v1/messages', '/v1/board', '/v1/responder/connect', '/v1/responder/revoke', '/v1/agent/inbox', '/v1/agent/replies', '/v1/agent/board']);
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const randomKey = () => Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const json = (data, status=200) => Response.json(data, {status});
const publicState = state => ({messages:state.messages, posts:state.posts});
const unanswered = state => state.messages.filter(m=>m.role==='user' && !state.messages.some(r=>r.kind==='reply' && r.replyTo===m.id));
export default {
  async fetch(request, env, executionCtx) {
    const claude=await claudeChatPublic(request,env);if(claude)return claude;
    const makima=await makimaConnector(request,env,executionCtx);if(makima)return makima;
    const project=await projectTransport(request,env);if(project)return project;
    const relay=await relayConnector(request,env);if(relay)return relay;
    const agents=await agentChatPublic(request,env);if(agents)return agents;
    const mast=await mastAdapterPublic(request,env);if(mast)return mast;
    const owner=await relayOwnerPublic(request,env);if(owner)return owner;
    const native=await nativeMusic(request,env);if(native)return native;
    const media = await music(request, env); if (media) return media;
    const connected=await connector(request,env,{syncShared,sharedInternal});if(connected)return connected;
    const origin=request.headers.get('Origin');
    if(origin && !FRONTEND_ORIGINS.has(origin)) return json({error:'Origin not allowed'},403);
    const headers={'Access-Control-Allow-Origin':origin||PRIMARY_SITE,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600','Vary':'Origin','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json'}});
    if(request.method==='OPTIONS') return new Response(null,{status:204,headers});
    const podcast=await podcasts(request,reply);if(podcast)return podcast;
    const guitar=await guitarSources(request,reply,headers)||await songsterr(request,reply);if(guitar)return guitar;
    const path=new URL(request.url).pathname;
    if(path==='/health' && request.method==='GET') return reply({ok:true,mode:'github-publications',version:7,publicationIssue:2});
    if(path==='/shared/import-hint'){
      if(request.method!=='POST')return reply({error:'Method not allowed'},405);
      if(new URL(request.url).search)return reply({error:'Hint accepts only a JSON commentId'},400);
      if(!request.headers.get('Content-Type')?.startsWith('application/json'))return reply({error:'Expected JSON'},415);
      let data;try{data=JSON.parse(await boundedText(request,256));}catch(error){return reply({error:'Invalid hint body'},error instanceof RelayError?413:400);}
      if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==1||!Number.isSafeInteger(data.commentId)||data.commentId<1)
        return reply({error:'Expected only a positive numeric commentId'},400);
      try{const response=await sharedInternal(env,'/import-hint',data);
        return new Response(response.body,{status:response.status,headers:{...headers,'Content-Type':'application/json',...(response.headers.has('Retry-After')?{'Retry-After':response.headers.get('Retry-After')}:{})}});
      }catch{return reply({error:'Import hint unavailable; use the existing reconciler'},503);}
    }
    if(['/shared/state','/shared/changes','/shared/result','/shared/messages','/shared/board-draft'].includes(path)) {
      if((path!=='/shared/messages'&&request.method!=='GET')||(path==='/shared/messages'&&request.method!=='POST'))return reply({error:'Method not allowed'},405);
      let data;
      if(request.method==='POST'){
        if(!request.headers.get('Content-Type')?.startsWith('application/json'))return reply({error:'Expected JSON'},415);
        const reader=request.body?.getReader();if(!reader)return reply({error:'Body required'},400);
        const chunks=[];let size=0;
        for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>20000){await reader.cancel();return reply({error:'Body too large'},413);}chunks.push(value);}
        const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
        try{const b=JSON.parse(new TextDecoder().decode(bytes));data={id:b.id,body:b.body};}catch{return reply({error:'Invalid JSON'},400);}
      }
      try {
        const suffix=request.method==='GET'?path.slice('/shared'.length)+new URL(request.url).search:'/message';
        const response=await sharedInternal(env,suffix,data);
        return new Response(response.body,{status:response.status,headers:{...headers,'Content-Type':'application/json'}});
      }catch{return reply({error:'Storage unavailable; retry later'},503);}
    }
    if(!paths.has(path)) return reply({error:'Not found'},404);
    const readPath=path==='/v1/state' || path==='/v1/agent/inbox';
    if((readPath && request.method!=='GET') || (!readPath && request.method!=='POST')) return reply({error:'Method not allowed'},405);
    const token=(request.headers.get('Authorization')||'').match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if(!token) return reply({error:'Workspace key required'},401);
    let body;
    if(request.method==='POST') {
      if(!request.headers.get('Content-Type')?.startsWith('application/json')) return reply({error:'Expected JSON'},415);
      // Bound actual streamed bytes, not just a client-controlled length header.
      const reader=request.body?.getReader();
      if(!reader) return reply({error:'Body required'},400);
      const chunks=[];let length=0;
      while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>30000){await reader.cancel();return reply({error:'Body too large'},413);}chunks.push(value);}
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return reply({error:'Invalid JSON'},400);}
      if(!path.startsWith('/v1/responder/')) {
      const bodyLimit=path==='/v1/messages'?4000:(path==='/v1/board'||path==='/v1/agent/board'?20000:6000);
      if(!body || typeof body.id!=='string' || !/^[a-f0-9-]{36}$/.test(body.id) || typeof body.body!=='string' || !body.body.trim() || body.body.length>bodyLimit) return reply({error:'Invalid entry'},400);
      if((path==='/v1/board' || path==='/v1/agent/board') && (typeof body.title!=='string' || !body.title.trim() || body.title.length>120)) return reply({error:'Invalid title'},400);
      if(path==='/v1/agent/replies' && (typeof body.replyTo!=='string' || !/^[a-f0-9-]{36}$/.test(body.replyTo))) return reply({error:'Reply target required'},400);
      }
    }
    const name=await digest(token);
    const object=n=>env.HUBS.get(env.HUBS.idFromName(n));
    const internal=(n,p,data,headers={})=>object(n).fetch(new Request('https://internal'+p,{method:data?'POST':'GET',headers,body:data?JSON.stringify(data):undefined}));
    try {
      let response;
      if(path==='/v1/responder/connect') {
        // Separate responder credential; never hand the browser's owner key to an agent.
        const responderToken=randomKey(), responderHash=await digest(responderToken);
        const expiresAt=null;
        await internal('responder:'+responderHash,'/internal/register',{workspace:name,expiresAt});
        await internal(name,'/internal/authorize',{hash:responderHash,expiresAt});
        return reply({token:responderToken,expiresAt});
      } else if(path==='/v1/responder/revoke') {
        response=await internal(name,'/internal/authorize',{hash:null,expiresAt:0});
      } else if(path.startsWith('/v1/agent/')) {
        const access=await (await internal('responder:'+name,'/internal/access')).json();
        if(!access.workspace || (access.expiresAt!==null && access.expiresAt<=Date.now())) return reply({error:'Responder connection expired or invalid'},401);
        response=await internal(access.workspace,path,body,{'X-Responder-Hash':name});
      } else response=await internal(name,path,body);
      return new Response(response.body,{status:response.status,headers:{...headers,'Content-Type':'application/json'}});
    } catch {return reply({error:'Storage unavailable; retry later'},503);}
  }
};
export class Hub {
  constructor(ctx,env,runtime={}){
    this.ctx=ctx;this.env=env||{};
    // Resolve the production global at call time; local fixtures may supply a
    // fictional responder without changing environment or authorization state.
    this.publicationFetcher=runtime.publicationFetcher||((...args)=>fetch(...args));
  }
  async withCoreWake(operation){
    const wake=await reserveRelayCoreWake(this.ctx);
    try{return await operation(wake);}
    finally{
      releaseRelayCoreWake(this.ctx,wake);
      // A committed save keeps its receipt even if this fine-grained setter
      // fails. Its earlier durable precommit wake remains available for repair.
      try{await scheduleRelayAlarm(this.ctx);}catch{}
    }
  }
  async syncPublicRead(){
    sharedSchema(this.ctx);
    if(!this.publicationSync)this.publicationSync=(async()=>{
      const now=Date.now();let wake=null;
      if(publicationReadNeedsWake(this.ctx,now,this.env))wake=await reserveRelayCoreWake(this.ctx,now);
      try{await syncPublications(this.ctx,this.publicationFetcher,Date.now(),this.env);}
      finally{
        releaseRelayCoreWake(this.ctx,wake);
        try{await scheduleRelayAlarm(this.ctx);}catch{}
      }
    })().finally(()=>{this.publicationSync=null;});
    return this.publicationSync;
  }
  async alarm(){
    // The music catalog object's alarm only retries a catalog publish.
    if(isMusicCatalog(this.ctx))return musicCatalogAlarm(this.ctx,this.env);
    // Keep a durable retry before any import or callback await. The two lanes
    // perform bounded work, then one compositor selects their shared next wake.
    const wake=await beginRelayCoreAlarm(this.ctx);
    try{
      const due=nextPublicationReconciliationAt(this.ctx);
      if(due!==null&&due<=Date.now())await syncPublications(this.ctx,this.publicationFetcher,Date.now(),this.env);
      const transport=webhookTransport(this.env);
      await drainRelayOutbox(this.ctx,this.env,transport,Date.now(),{schedule:false});
      releaseRelayCoreWake(this.ctx,wake);
      await scheduleRelayAlarm(this.ctx,Date.now(),transport?0:60000);
    }catch(error){abandonRelayCoreAlarm(this.ctx,wake);throw error;}
  }
  async fetch(request){
    const path=new URL(request.url).pathname;
    if(path==='/internal/relay/board/agent'){
      if(this.ctx.id?.name && this.ctx.id.name!==RELAY_OAUTH_OBJECT)return json({error:'Wrong board object'},403);
      try{return json(await boardAgentStore(this.ctx,this.env,await request.json()));}
      catch(error){return json({error:{code:error instanceof RelayError?error.code:-32603,message:error instanceof RelayError?error.message:'Board unavailable'}},error.data?.status||400);}
    }
    if(path.startsWith('/internal/relay/makima/')){
      if(this.ctx.id?.name && this.ctx.id.name!==MAKIMA_OBJECT)return json({error:'Wrong Makima object'},403);
      if(!makimaEnabled(this.env))return json({error:'Makima adapter is not activated'},503);
      try{
        const input=await request.json();
        if(path==='/internal/relay/makima/oauth')return relayOAuthStore(this.ctx,input,Date.now(),this.env,makimaOAuthPolicy);
        if(path==='/internal/relay/makima/board-auth')return json(await boardMakimaAuth(this.ctx,this.env,input));
        if(path==='/internal/relay/makima/rpc')return json({result:await makimaRpc(this.ctx,this.env,input.principal,input.rpc)});
        if(path==='/internal/relay/makima/channel')return json(makimaChannelStore(this.ctx,this.env,input));
      }catch(error){
        // OAuth callers use HTTP status to distinguish unavailable storage from
        // a missing/consumed record. Keep the RPC envelope behavior unchanged.
        if(path==='/internal/relay/makima/oauth')return json({error:'Makima storage unavailable'},503);
        return json({error:{code:error instanceof RelayError?error.code:-32603,message:error instanceof RelayError?error.message:'Makima storage unavailable'}});
      }
      return json({error:'Not found'},404);
    }
    if(path==='/internal/relay/projects'){
      const input=await request.json(),operation=()=>projectStore(this.ctx,this.env,input);
      if(input.op==='send'){
        const authorized=projectStore(this.ctx,this.env,{...input,op:'identity',args:{}});
        if(!authorized.ok)return authorized;
        return this.withCoreWake(operation);
      }
      return operation();
    }
    if(path==='/internal/music'){
      if(this.ctx.id?.name && this.ctx.id.name!==MUSIC_CATALOG_OBJECT)return json({error:'Wrong music object'},403);
      return musicCatalogInternal(this.ctx,this.env,await request.json());
    }
    if(path==='/internal/claude-chat'){
      if(this.ctx.id?.name && this.ctx.id.name!==CLAUDE_CHAT_OBJECT)return json({error:'Wrong chat object'},403);
      return claudeChatInternal(this.ctx,this.env,await request.json());
    }
    if(path==='/internal/relay/agents')return agentChatStore(this.ctx,this.env,await request.json());
    if(path==='/internal/relay/mast')return mastAdapterStore(this.ctx,this.env,await request.json());
    if(path==='/internal/relay/oauth')return relayOAuthStore(this.ctx,await request.json(),Date.now(),this.env);
    if(path==='/internal/relay/owner'){
      try {
        const body=await request.json();
        // The shared journal can replay both inbox kinds even on a fresh owner-only object.
        sharedSchema(this.ctx);
        const operation=()=>relayOwnerStore(this.ctx,this.env,body,enqueueRelayOwnerMessage);
        return ['message','job_create','job_retry','delivery_retry'].includes(body?.op)?await this.withCoreWake(operation):await operation();
      } catch { return json({error:'Owner Relay storage unavailable'},503); }
    }
    if(path==='/internal/relay/assistant-attachment-admit'){
      try{const {principal}=await request.json();return json(relayOwnerAssistantAttachmentIngress(this.ctx,this.env,principal));}
      catch(error){return json({error:{code:error instanceof RelayError?error.code:-32603,message:error instanceof RelayError?error.message:'Relay attachment admission unavailable',...(error instanceof RelayError&&error.data?{data:error.data}:{})}});}
    }
    if(path==='/internal/relay/rpc'){
      try{const {principal,rpc}=await request.json();return json({result:await relayRpc(this.ctx,this.env,principal,rpc,{syncPublicRead:()=>this.syncPublicRead(),withCoreWake:operation=>this.withCoreWake(operation)})});}
      catch(error){return json({error:{code:error instanceof RelayError?error.code:-32603,message:error instanceof RelayError?error.message:'Relay storage unavailable',...(error instanceof RelayError&&error.data?{data:error.data}:{})}});}
    }
    if(path.startsWith('/internal/shared/')) {
      // A Daily Board draft preview: read-only, by its private token, never cached.
      if(path==='/internal/shared/board-draft')return request.method==='GET'?readBoardDraft(this.ctx,new URL(request.url).searchParams):json({error:'Method not allowed'},405);
      if(path==='/internal/shared/legacy-page')return request.method==='GET'?readLegacyInboxPage(this.ctx,new URL(request.url).searchParams):json({error:'Method not allowed'},405);
      if(path==='/internal/shared/reconcile-legacy'){
        await this.syncPublicRead();
        return json({ok:true});
      }
      if(path==='/internal/shared/import-hint'){
        const data=await request.json();
        return importPublicationHint(this.ctx,data,fetch,Date.now(),operation=>this.withCoreWake(async wake=>{
          assertRelayCoreWake(this.ctx,wake);
          // Seed before the journal's first await so interrupted admitted work
          // retains reconciliation independently of its callback/receipt.
          seedPublicationReconciliation(this.ctx,Date.now());
          return operation();
        }));
      }
      // Persist the wake before committing a new message/event, so a crash after
      // commit cannot strand its outbox. SQLite and normal Durable Object storage
      // share the same object; old imported rows never become live events.
      if(path==='/internal/shared/message')return this.withCoreWake(async wake=>{
        const data=await request.json();assertRelayCoreWake(this.ctx,wake);
        const response=sharedStore(this.ctx,path,data);
        if(response.ok)seedPublicationReconciliation(this.ctx,Date.now(),this.env,{initialAlarmDelay:300000});
        return response;
      });
      if(['/internal/shared/state','/internal/shared/changes','/internal/shared/result'].includes(path)) {
        const validation=validateSharedRead(this.ctx,path,new URL(request.url).searchParams);
        if(validation)return validation;
        await this.syncPublicRead();
      }
      const response=sharedStore(this.ctx,path,request.method==='POST'?await request.json():{},new URL(request.url).searchParams);
      return response;
    }
    if(path==='/internal/oauth-store')return oauthStore(this.ctx.storage,await request.json());
    if(path==='/internal/register'){await this.ctx.storage.put('access',await request.json());return json({ok:true});}
    if(path==='/internal/access')return json(await this.ctx.storage.get('access') || {});
    if(path==='/internal/authorize'){await this.ctx.storage.put('responder',await request.json());return json({ok:true});}
    if(path.startsWith('/v1/agent/')) {
      const access=await this.ctx.storage.get('responder');
      if(!access || (access.expiresAt!==null && access.expiresAt<=Date.now()) || access.hash!==request.headers.get('X-Responder-Hash'))return json({error:'Responder disconnected'},401);
    }
    if(request.method==='GET'){
      const state=await this.ctx.storage.get('state') || {messages:[],posts:[]};
      return json(path==='/v1/agent/inbox'?{...publicState(state),unanswered:unanswered(state)}:publicState(state));
    }
    const body=await request.json();
    return this.ctx.storage.transaction(async tx=>{
      const state=await tx.get('state') || {messages:[],posts:[],lastWrite:0};
      // Repeat checks inside the write transaction so revocation cannot race a reply.
      if(path.startsWith('/v1/agent/')) {
        const access=await tx.get('responder');
        if(!access || (access.expiresAt!==null && access.expiresAt<=Date.now()) || access.hash!==request.headers.get('X-Responder-Hash'))return json({error:'Responder disconnected'},401);
      }
      if(path==='/v1/agent/replies') {
        if(!state.messages.some(m=>m.id===body.replyTo && m.role==='user'))return json({error:'Original message not found'},404);
        const prior=state.messages.find(m=>m.kind==='reply' && m.replyTo===body.replyTo);
        if(prior)return prior.body===body.body.trim()?json(publicState(state)):json({error:'Message already answered'},409);
      }
      const existing=[...state.messages,...state.posts].find(x=>x.id===body.id);
      if(existing){
        if(existing.body!==body.body.trim() || ((path==='/v1/board' || path==='/v1/agent/board') && existing.title!==body.title.trim()) || (path==='/v1/messages' && existing.role!=='user') || (path==='/v1/agent/replies' && (existing.kind!=='reply' || existing.replyTo!==body.replyTo)))return json({error:'Entry ID conflict'},409);
        return json(publicState(state));
      }
      const now=Date.now();
      const createdAt=new Date(now).toISOString();
      if(path==='/v1/messages')state.messages.push({id:body.id,role:'user',body:body.body.trim(),createdAt},{id:'receipt-'+body.id,role:'assistant',kind:'receipt',body:'Message received and saved. This is an automatic delivery receipt, not a Jarvis reply.',createdAt});
      else if(path==='/v1/agent/replies')state.messages.push({id:body.id,role:'assistant',kind:'reply',replyTo:body.replyTo,body:body.body.trim(),createdAt});
      else state.posts.push({id:body.id,title:body.title.trim(),body:body.body.trim(),createdAt});
      state.lastWrite=now;
      if(new TextEncoder().encode(JSON.stringify(state)).length>100000)return json({error:'Workspace is full; export before adding more entries'},507);
      await tx.put('state',state);
      return json(publicState(state),201);
    });
  }
}
export async function sharedInternal(env,path,body) {
  return env.HUBS.get(env.HUBS.idFromName(SHARED_OBJECT)).fetch(new Request('https://internal/internal/shared'+path,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined}));
}
export async function syncShared(env) {
  // All callers share the durable bounded importer and its persisted cooldown.
  const imported=await sharedInternal(env,'/reconcile-legacy');
  if(!imported.ok)throw Error('Inbox reconciliation unavailable');
}


