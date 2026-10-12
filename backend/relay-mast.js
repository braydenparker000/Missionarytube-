import {mastWork} from './relay-mast-work.js';
import {ATTACHMENT_BODY_LIMIT} from './relay-owner-attachments.js';
import {mastFileMetadata,mastFileCheckMessage,mastFileLink,mastFileOperation} from './relay-mast-attachments.js';
// Owner-to-Mast only. No public inbox, owner Relay entries, OAuth grants or callbacks.
import {RELAY_OAUTH_OBJECT, RelayError, fields, uuid, cursor, json, hash, equal, boundedText} from './relay-common.js';
const fail = (status, message) => { throw new RelayError(-32602, message, {status}); };
const rows = (ctx, query, ...args) => [...ctx.storage.sql.exec(query, ...args)];
export const mastEnabled = env => env.RELAY_MCP_ENABLED === 'true' && env.RELAY_OWNER_ENABLED === 'true'
  && env.RELAY_MAST_ENABLED === 'true' && /^[a-f0-9]{64}$/.test(env.RELAY_MAST_TOKEN_SHA256 || '');
function schema(ctx) {
  ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS relay_mast_entries (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('owner','mast')), reply_to TEXT UNIQUE,
    body TEXT NOT NULL, created_at TEXT NOT NULL, device_id TEXT NOT NULL)`);
}
function adapterState(ctx,env){
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS relay_mast_presence (token_hash TEXT PRIMARY KEY,fetched_ms INTEGER NOT NULL,fetched_sequence INTEGER NOT NULL)');
  const record=rows(ctx,'SELECT fetched_ms,fetched_sequence FROM relay_mast_presence WHERE token_hash=?',env.RELAY_MAST_TOKEN_SHA256)[0];
  return record?{lastFetchedAt:new Date(record.fetched_ms).toISOString(),fetchedSequence:record.fetched_sequence}:null;
}
function entry(row,ctx) {
  return {id:row.id, sequence:row.seq, role:row.role, body:row.body, createdAt:row.created_at, replyTo:row.reply_to, visibility:'private', destination:'mast',attachments:mastFileMetadata(ctx,row.id)};
}
export function mastList(ctx, env, after) {
  const offset = cursor(after) || 0;
  // A closed installation creates no Mast storage and exposes no history.
  if (!mastEnabled(env)) return {enabled:false, messages:[], nextCursor:null};
  schema(ctx);
  const selected = rows(ctx, 'SELECT * FROM relay_mast_entries WHERE seq>? ORDER BY seq LIMIT 51', offset);
  return {enabled:true, adapter:adapterState(ctx,env), messages:selected.slice(0,50).map(row=>entry(row,ctx)), nextCursor:selected.length>50?String(selected[49].seq):null};
}
export function mastSend(ctx, env, body, session, now = Date.now()) {
  if (!mastEnabled(env)) fail(503, 'Mast chat awaits activation');
  if (!uuid(body.id) || typeof body.body !== 'string' || !body.body.trim()&&!body.attachment_ids?.length || body.body.length>4000) fail(400,'Invalid Mast message');
  schema(ctx);
  return insert(ctx, {id:body.id, role:'owner', replyTo:null, body:body.body.trim(), device:session.device_id,attachmentIds:body.attachment_ids,actor:'owner:'+session.device_id}, now);
}
function insert(ctx, message, now) {
  const previous = rows(ctx,'SELECT * FROM relay_mast_entries WHERE id=?',message.id)[0];
  const files=mastFileCheckMessage(ctx,message.id,message.attachmentIds,message.actor,message.replyTo,now,previous);
  if (previous) {
    if (previous.role!==message.role || previous.body!==message.body || previous.reply_to!==message.replyTo || previous.device_id!==message.device) fail(409,'Mast message ID conflict');
    return {entry:entry(previous,ctx), newWrite:false};
  }
  if (rows(ctx,'SELECT COUNT(*) AS n FROM relay_mast_entries')[0].n>=10000) fail(429,'Mast chat storage is full');
  ctx.storage.sql.exec('INSERT INTO relay_mast_entries(id,role,reply_to,body,created_at,device_id) VALUES(?,?,?,?,?,?)',message.id,message.role,message.replyTo,message.body,new Date(now).toISOString(),message.device);
  mastFileLink(ctx,message.id,files);
  return {entry:entry(rows(ctx,'SELECT * FROM relay_mast_entries WHERE id=?',message.id)[0],ctx),newWrite:true};
}
export const mastWorkEnabled = env => mastEnabled(env) && env.RELAY_MAST_WORK_ENABLED === 'true';
export function mastOwnerWork(ctx,env,input,session){
  if(!mastWorkEnabled(env))fail(503,'Mast Work is not activated');
  if(!mastEnabled(env))fail(503,'Mast chat awaits activation');schema(ctx);
  return mastWork(ctx,{...input,op:input.op.slice(5)},{owner:session,send:body=>mastSend(ctx,env,body,session)});
}
export async function mastOwnerFileStore(ctx,env,input,requireOwner){
  const authorize=()=>{if(!mastEnabled(env))fail(503,'Mast chat awaits activation');const actor=requireOwner();schema(ctx);return 'owner:'+actor.device_id;};
  return mastFileOperation(ctx,{...input,op:input.op.slice(5)},authorize);
}
export async function mastAdapterStore(ctx, env, input) {
  try {
    // Recheck authorization at the storage boundary. Owner credentials cannot substitute.
    if (!mastEnabled(env)) return json({error:'Mast adapter is not activated'},503);
    if (typeof input.token_hash!=='string' || !equal(input.token_hash,env.RELAY_MAST_TOKEN_SHA256)) return json({error:'Mast authentication required'},401);
    const authorize=()=>{
      if(!mastEnabled(env)||typeof input.token_hash!=='string'||!equal(input.token_hash,env.RELAY_MAST_TOKEN_SHA256))fail(401,'Mast authentication required');
      schema(ctx);return 'mast:'+input.token_hash;
    };
    if(input.op?.startsWith('file_'))return await mastFileOperation(ctx,input,authorize);
    return ctx.storage.transactionSync(() => {
      if(input.op?.startsWith('work_')){if(!mastWorkEnabled(env))fail(503,'Mast Work is not activated');return json(mastWork(ctx,input,{writer:authorize()}));}
      if (input.op==='list') {
        fields(input,['op','token_hash','after'],['op','token_hash']);
        const result=mastList(ctx,env,input.after),now=Date.now();
        const sequence=result.messages.at(-1)?.sequence||0;
        rows(ctx,'DELETE FROM relay_mast_presence WHERE token_hash<>?',input.token_hash);
        rows(ctx,'INSERT INTO relay_mast_presence VALUES(?,?,?) ON CONFLICT(token_hash) DO UPDATE SET fetched_ms=excluded.fetched_ms,fetched_sequence=MAX(fetched_sequence,excluded.fetched_sequence)',input.token_hash,now,sequence);
        return json(result);
      }
      fields(input,['op','token_hash','id','reply_to','body','attachment_ids'],['op','token_hash','id','reply_to','body']);
      if (input.op!=='reply' || !uuid(input.id) || !uuid(input.reply_to) || typeof input.body!=='string' || !input.body.trim()&&!input.attachment_ids?.length || input.body.length>6000) fail(400,'Invalid Mast reply');
      schema(ctx);
      if (!rows(ctx,"SELECT id FROM relay_mast_entries WHERE id=? AND role='owner'",input.reply_to).length) fail(404,'Mast message not found');
      const previous = rows(ctx,'SELECT id FROM relay_mast_entries WHERE reply_to=?',input.reply_to)[0];
      if (previous && previous.id!==input.id) fail(409,'Mast message already has a reply');
      const result=insert(ctx,{id:input.id,role:'mast',replyTo:input.reply_to,body:input.body.trim(),device:'mast-adapter',actor:authorize(),attachmentIds:input.attachment_ids},Date.now());
      return json(result,result.newWrite?201:200);
    });
  } catch(error) { return json({error:error instanceof RelayError?error.message:'Mast storage unavailable',...(error.data?.code?{code:error.data.code}:{})},error instanceof RelayError?error.data?.status||400:503); }
}
export async function mastAdapterPublic(request, env) {
  const url=new URL(request.url);
  if (!url.pathname.startsWith('/relay/mast/')) return null;
  if (!mastEnabled(env)) return json({error:'Mast adapter is not activated'},503);
  // Server-to-server adapter: no browser CORS and no arbitrary delivery URLs.
  if (request.headers.has('Origin')) return json({error:'Browser access not allowed'},403);
  try {
    const token=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,512})$/)?.[1];
    if (!token || !equal(await hash(token),env.RELAY_MAST_TOKEN_SHA256)) return json({error:'Mast authentication required'},401);
    if((url.pathname==='/relay/mast/work'||url.pathname.startsWith('/relay/mast/work/'))&&!mastWorkEnabled(env))fail(503,'Mast Work is not activated');
    const store=body=>env.HUBS.get(env.HUBS.idFromName(RELAY_OAUTH_OBJECT)).fetch(new Request('https://internal/internal/relay/mast',{method:'POST',body:JSON.stringify({...body,token_hash:tokenHash})}));
    const tokenHash=await hash(token);
    let input;
    if(url.pathname==='/relay/mast/work'&&request.method==='GET'){
      if([...url.searchParams.keys()].some(k=>!['after','job_id'].includes(k)||url.searchParams.getAll(k).length!==1)||url.searchParams.has('after')&&url.searchParams.has('job_id'))fail(400,'Invalid Muse work query');
      input={...Object.fromEntries(url.searchParams),op:url.searchParams.has('job_id')?'work_read':'work_list'};
    }else if(/^\/relay\/mast\/work\/(claim|update|plan|correct)$/.test(url.pathname)&&request.method==='POST'&&!url.search){
      const body=JSON.parse(await boundedText(request,16000));input={...body,op:'work_'+url.pathname.split('/').at(-1)};
    }else if (url.pathname==='/relay/mast/messages' && request.method==='GET') {
      if ([...url.searchParams.keys()].some(k=>k!=='after') || url.searchParams.getAll('after').length>1) fail(400,'Invalid Mast query');
      input={op:'list',after:url.searchParams.get('after')||'0'};
    } else if (url.pathname==='/relay/mast/files/content' && request.method==='GET') {
      if([...url.searchParams.keys()].some(k=>!['message_id','attachment_id','preview'].includes(k)||url.searchParams.getAll(k).length!==1))fail(400,'Invalid Mast file query');
      if(url.searchParams.has('preview')&&url.searchParams.get('preview')!=='1')fail(400,'Invalid Mast preview');
      input={op:'file_content',message_id:url.searchParams.get('message_id'),attachment_id:url.searchParams.get('attachment_id'),preview:url.searchParams.has('preview')};
    } else if (['/relay/mast/files','/relay/mast/files/discard'].includes(url.pathname) && request.method==='POST' && !url.search) {
      const upload=url.pathname==='/relay/mast/files';
      if(upload){const admitted=await store({op:'file_admit'});if(!admitted.ok)return admitted;}
      const body=JSON.parse(await boundedText(request,upload?ATTACHMENT_BODY_LIMIT:16000));
      const keys=upload?['id','message_id','reply_to','name','mime_type','data_base64']:['message_id','attachment_id'];fields(body,keys,keys);
      input={...body,op:upload?'file_upload':'file_discard'};
    } else if (url.pathname==='/relay/mast/reply' && request.method==='POST' && !url.search) {
      const body=JSON.parse(await boundedText(request,16000));
      fields(body,['id','reply_to','body','attachment_ids'],['id','reply_to','body']);
      input={...body,op:'reply'};
    } else return json({error:'Not found'},404);
    return await store(input);
  } catch(error) { return json({error:error instanceof RelayError?error.message:'Invalid Mast request'},error instanceof RelayError?error.data?.status||400:400); }
}
