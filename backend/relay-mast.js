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
function entry(row) {
  return {id:row.id, sequence:row.seq, role:row.role, body:row.body, createdAt:row.created_at, replyTo:row.reply_to, visibility:'private', destination:'mast'};
}
export function mastList(ctx, env, after) {
  const offset = cursor(after) || 0;
  // A closed installation creates no Mast storage and exposes no history.
  if (!mastEnabled(env)) return {enabled:false, messages:[], nextCursor:null};
  schema(ctx);
  const selected = rows(ctx, 'SELECT * FROM relay_mast_entries WHERE seq>? ORDER BY seq LIMIT 51', offset);
  return {enabled:true, messages:selected.slice(0,50).map(entry), nextCursor:selected.length>50?String(selected[49].seq):null};
}
export function mastSend(ctx, env, body, session, now = Date.now()) {
  if (!mastEnabled(env)) fail(503, 'Mast chat awaits activation');
  if (!uuid(body.id) || typeof body.body !== 'string' || !body.body.trim() || body.body.length>4000) fail(400,'Invalid Mast message');
  schema(ctx);
  return insert(ctx, {id:body.id, role:'owner', replyTo:null, body:body.body.trim(), device:session.device_id}, now);
}
function insert(ctx, message, now) {
  const previous = rows(ctx,'SELECT * FROM relay_mast_entries WHERE id=?',message.id)[0];
  if (previous) {
    if (previous.role!==message.role || previous.body!==message.body || previous.reply_to!==message.replyTo || previous.device_id!==message.device) fail(409,'Mast message ID conflict');
    return {entry:entry(previous), newWrite:false};
  }
  if (rows(ctx,'SELECT COUNT(*) AS n FROM relay_mast_entries')[0].n>=10000) fail(429,'Mast chat storage is full');
  ctx.storage.sql.exec('INSERT INTO relay_mast_entries(id,role,reply_to,body,created_at,device_id) VALUES(?,?,?,?,?,?)',message.id,message.role,message.replyTo,message.body,new Date(now).toISOString(),message.device);
  return {entry:entry(rows(ctx,'SELECT * FROM relay_mast_entries WHERE id=?',message.id)[0]),newWrite:true};
}
export function mastAdapterStore(ctx, env, input) {
  try {
    // Recheck authorization at the storage boundary. Owner credentials cannot substitute.
    if (!mastEnabled(env)) return json({error:'Mast adapter is not activated'},503);
    if (typeof input.token_hash!=='string' || !equal(input.token_hash,env.RELAY_MAST_TOKEN_SHA256)) return json({error:'Mast authentication required'},401);
    return ctx.storage.transactionSync(() => {
      if (input.op==='list') {
        fields(input,['op','token_hash','after'],['op','token_hash']);
        return json(mastList(ctx,env,input.after));
      }
      fields(input,['op','token_hash','id','reply_to','body'],['op','token_hash','id','reply_to','body']);
      if (input.op!=='reply' || !uuid(input.id) || !uuid(input.reply_to) || typeof input.body!=='string' || !input.body.trim() || input.body.length>6000) fail(400,'Invalid Mast reply');
      schema(ctx);
      if (!rows(ctx,"SELECT id FROM relay_mast_entries WHERE id=? AND role='owner'",input.reply_to).length) fail(404,'Mast message not found');
      const previous = rows(ctx,'SELECT id FROM relay_mast_entries WHERE reply_to=?',input.reply_to)[0];
      if (previous && previous.id!==input.id) fail(409,'Mast message already has a reply');
      const result=insert(ctx,{id:input.id,role:'mast',replyTo:input.reply_to,body:input.body.trim(),device:'mast-adapter'},Date.now());
      return json(result,result.newWrite?201:200);
    });
  } catch(error) { return json({error:error instanceof RelayError?error.message:'Mast storage unavailable'},error instanceof RelayError?error.data?.status||400:503); }
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
    let input;
    if (url.pathname==='/relay/mast/messages' && request.method==='GET') {
      if ([...url.searchParams.keys()].some(k=>k!=='after') || url.searchParams.getAll('after').length>1) fail(400,'Invalid Mast query');
      input={op:'list',after:url.searchParams.get('after')||'0'};
    } else if (url.pathname==='/relay/mast/reply' && request.method==='POST' && !url.search) {
      const body=JSON.parse(await boundedText(request,16000));
      fields(body,['id','reply_to','body'],['id','reply_to','body']);
      input={...body,op:'reply'};
    } else return json({error:'Not found'},404);
    input.token_hash=await hash(token);
    return await env.HUBS.get(env.HUBS.idFromName(RELAY_OAUTH_OBJECT)).fetch(new Request('https://internal/internal/relay/mast',{method:'POST',body:JSON.stringify(input)}));
  } catch(error) { return json({error:error instanceof RelayError?error.message:'Invalid Mast request'},error instanceof RelayError?error.data?.status||400:400); }
}
