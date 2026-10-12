import {agentChatEnabled} from './relay-agent-events.js';
export {agentChatEnabled} from './relay-agent-events.js';
import {enqueueRelayAgentMessage,scheduleRelayAlarm} from './relay-events.js';
import {reserveRelayCoreWake,releaseRelayCoreWake} from './relay-core-alarm.js';
// Independent agent conversation. Owner/Mast credentials do not grant access.
// Lucy needs explicit channel OAuth scope; Muse uses a distinct dedicated bearer.
import {RELAY_OAUTH_OBJECT,RELAY_AGENT_SCOPE,RELAY_OWNER,RelayError,hash,equal,uuid,cursor,fields,json,boundedText} from './relay-common.js';
import {ATTACHMENT_BODY_LIMIT} from './relay-owner-attachments.js';
import {mastFileMetadata,mastFileCheckMessage,mastFileLink,mastFileOperation} from './relay-mast-attachments.js';
import {relayTokenActiveInStore} from './relay-oauth.js';
export const AGENT_CHAT_OBJECT=RELAY_OAUTH_OBJECT;
// Fixed SQL namespace, not a user-selected table or owner-history adapter.
const isolated=ctx=>({storage:{sql:{exec:(sql,...args)=>ctx.storage.sql.exec(sql.replaceAll('relay_mast_','relay_agents_'),...args)},transactionSync:fn=>ctx.storage.transactionSync(fn)}});
const rows=(ctx,q,...v)=>[...ctx.storage.sql.exec(q,...v)];
const fail=(status,message)=>{throw new RelayError(-32602,message,{status});};
function identity(env,digest){
  if(!agentChatEnabled(env))fail(503,'Lucy–Muse channel is not activated');
  if(typeof digest!=='string'||!equal(digest,env.RELAY_AGENT_MUSE_TOKEN_SHA256))fail(401,'Muse channel authentication required');
  return 'muse';
}
function schema(ctx){
  // Same file repository schema, mapped to fixed separate channel tables.
  ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS relay_mast_entries (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('lucy','muse')),reply_to TEXT,
    body TEXT NOT NULL,created_at TEXT NOT NULL,device_id TEXT NOT NULL)`);
}
const entry=(ctx,r)=>({id:r.id,sequence:r.seq,role:r.role,replyTo:r.reply_to,body:r.body,createdAt:r.created_at,visibility:'private',destination:'lucy-muse',attachments:mastFileMetadata(ctx,r.id)});
function target(ctx,body){
  if(!uuid(body.message_id)||!uuid(body.id)||body.message_id===body.id)fail(400,'Invalid channel file IDs');
  if(body.reply_to!==undefined&&body.reply_to!==null&&(!uuid(body.reply_to)||!rows(ctx,'SELECT id FROM relay_mast_entries WHERE id=?',body.reply_to).length))fail(404,'Channel reply target not found');
}
export async function agentChatStore(sourceCtx,env,input){
  let wake=null;
  try{
    const principal=input.principal;
    const authorize=()=>{
      if(!agentChatEnabled(env))fail(503,'Lucy–Muse channel is not activated');
      if(principal){if(principal.principal!==RELAY_OWNER||!relayTokenActiveInStore(sourceCtx,env,principal,RELAY_AGENT_SCOPE))fail(403,'Explicit Lucy channel OAuth scope required');return 'lucy:'+principal.grantId;}
      identity(env,input.token_hash);return 'muse:'+input.token_hash;
    };
    const actor=authorize(),role=actor.startsWith('lucy:')?'lucy':'muse',ctx=isolated(sourceCtx);
    input={...input,token_hash:principal?.accessHash||input.token_hash};delete input.principal;
    if(input.op==='send'&&role==='muse'){wake=await reserveRelayCoreWake(sourceCtx);authorize();}
    schema(ctx);
    if(input.op?.startsWith('file_'))return await mastFileOperation(ctx,input,authorize,target);
    return ctx.storage.transactionSync(()=>{
      authorize();
      if(input.op==='list'){
        fields(input,['op','token_hash','after'],['op','token_hash']);const after=cursor(input.after)||0;
        const result=rows(ctx,'SELECT * FROM relay_mast_entries WHERE seq>? ORDER BY seq LIMIT 51',after);
        return json({destination:'lucy-muse',visibility:'private',identity:role,messages:result.slice(0,50).map(r=>entry(ctx,r)),nextCursor:result.length>50?String(result[49].seq):null});
      }
      fields(input,['op','token_hash','id','body','reply_to','attachment_ids'],['op','token_hash','id','body']);
      if(input.op!=='send'||!uuid(input.id)||typeof input.body!=='string'||input.body.length>6000||!input.body.trim()&&!input.attachment_ids?.length)fail(400,'Invalid channel message');
      const reply=input.reply_to??null;
      if(reply!==null&&(!uuid(reply)||reply===input.id||!rows(ctx,'SELECT id FROM relay_mast_entries WHERE id=?',reply).length))fail(404,'Channel reply target not found');
      const prior=rows(ctx,'SELECT * FROM relay_mast_entries WHERE id=?',input.id)[0],body=input.body.trim();
      if(prior&&(prior.role!==role||prior.body!==body||prior.reply_to!==reply))fail(409,'Channel message ID conflict');
      const files=mastFileCheckMessage(ctx,input.id,input.attachment_ids,authorize(),reply,Date.now(),prior);
      if(prior)return json({entry:entry(ctx,prior),newWrite:false});
      if(rows(ctx,'SELECT COUNT(*) AS n FROM relay_mast_entries')[0].n>=10000)fail(429,'Channel storage full');
      rows(ctx,'INSERT INTO relay_mast_entries(id,role,reply_to,body,created_at,device_id) VALUES(?,?,?,?,?,?)',input.id,role,reply,body,new Date().toISOString(),role);
      mastFileLink(ctx,input.id,files);
      if(role==='muse')enqueueRelayAgentMessage(sourceCtx,input.id);
      return json({entry:entry(ctx,rows(ctx,'SELECT * FROM relay_mast_entries WHERE id=?',input.id)[0]),newWrite:true},201);
    });
  }catch(e){return json({error:e instanceof RelayError?e.message:'Channel unavailable',...(e.data?.code?{code:e.data.code}:{})},e instanceof RelayError?e.data?.status||400:503);}
  finally{if(wake){releaseRelayCoreWake(sourceCtx,wake);try{await scheduleRelayAlarm(sourceCtx);}catch{}}}
}
export async function agentChatPublic(request,env){
  const url=new URL(request.url);if(!url.pathname.startsWith('/relay/agents/'))return null;
  try{
    if(!agentChatEnabled(env))fail(503,'Lucy–Muse channel is not activated');
    if(request.headers.has('Origin'))fail(403,'Browser access not allowed');
    const token=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,512})$/)?.[1];
    if(!token)fail(401,'Agent authentication required');const digest=await hash(token);identity(env,digest);
    const store=input=>env.HUBS.get(env.HUBS.idFromName(AGENT_CHAT_OBJECT)).fetch(new Request('https://internal/internal/relay/agents',{method:'POST',body:JSON.stringify({...input,token_hash:digest})}));
    const path=url.pathname.slice('/relay/agents/'.length);let input;
    if(request.method==='GET'&&['messages','files/content'].includes(path)){
      const allowed=path==='messages'?['after']:['message_id','attachment_id','preview'];
      if([...url.searchParams.keys()].some(k=>!allowed.includes(k)||url.searchParams.getAll(k).length!==1))fail(400,'Invalid channel query');
      input={...Object.fromEntries(url.searchParams),op:path==='messages'?'list':'file_content'};
      if(input.preview!==undefined){if(input.preview!=='1')fail(400,'Invalid preview');input.preview=true;}
    }else if(request.method==='POST'&&!url.search&&['messages','files','files/discard'].includes(path)){
      if(path==='files'){const admitted=await store({op:'file_admit'});if(!admitted.ok)return admitted;}
      const body=JSON.parse(await boundedText(request,path==='files'?ATTACHMENT_BODY_LIMIT:16000));
      const allowed=path==='messages'?['id','body','reply_to','attachment_ids']:path==='files'?['id','message_id','reply_to','name','mime_type','data_base64']:['message_id','attachment_id'];
      fields(body,allowed,allowed.filter(k=>!['reply_to','attachment_ids'].includes(k)));
      input={...body,op:path==='messages'?'send':path==='files'?'file_upload':'file_discard'};
    }else return json({error:'Not found'},404);
    return await store(input);
  }catch(e){return json({error:e instanceof RelayError?e.message:'Invalid channel request'},e instanceof RelayError?e.data?.status||400:400);}
}
