// Original connection validity and separately approved board membership are both
// required. This module never converts owner OAuth into owner-authored messages.
import {RELAY_AGENT_SCOPE,RELAY_OAUTH_OBJECT,RelayError,hash,equal,json} from './relay-common.js';
import {relayTokenActiveInStore,relayGrantActiveInStore} from './relay-oauth.js';
import {MAKIMA_OBJECT,MAKIMA_SCOPE,makimaEnabled,makimaOAuthPolicy} from './relay-makima-policy.js';
import {agentChatEnabled} from './relay-agent-events.js';
import {boardStore,boardFields} from './relay-board.js';
const fail=()=>{throw new RelayError(-32012,'Original board connection unavailable or revoked',{status:403});};
export const boardEnabled=env=>env.RELAY_MCP_ENABLED==='true'&&env.RELAY_BOARD_ENABLED==='true';
const connectionId=(agent,id)=>hash('jarvis-board-connection-v1:'+agent+':'+id);
const rows=(ctx,q,...v)=>[...ctx.storage.sql.exec(q,...v)];
const exists=ctx=>rows(ctx,"SELECT name FROM sqlite_master WHERE type='table' AND name='relay_oauth'").length;
function grants(ctx,env,agent){
 if(!exists(ctx))return [];
 const policy=agent==='makima'?makimaOAuthPolicy:undefined,scope=agent==='makima'?MAKIMA_SCOPE:RELAY_AGENT_SCOPE;
 return rows(ctx,"SELECT key FROM relay_oauth WHERE category='grant' AND expires_at>?",Date.now()).map(r=>r.key.slice(6)).filter(id=>relayGrantActiveInStore(ctx,env,id,scope,policy));
}
export async function boardMakimaAuth(ctx,env,input){
 if(!boardEnabled(env)||!makimaEnabled(env))fail();
 if(input.op==='connections')return {connections:await Promise.all(grants(ctx,env,'makima').map(async id=>({agent:'makima',connection_type:'makima-oauth-grant',connection_id:await connectionId('makima',id)})))};
 if(input.op!=='validate'||!input.principal||!relayTokenActiveInStore(ctx,env,input.principal,MAKIMA_SCOPE,makimaOAuthPolicy))fail();
 const id=await connectionId('makima',input.principal.grantId);
 if(!relayTokenActiveInStore(ctx,env,input.principal,MAKIMA_SCOPE,makimaOAuthPolicy))fail();
 return {agent:'makima',actor:'agent:makima',connectionId:id};
}
async function remoteMakima(env,input){
 const r=await env.HUBS.get(env.HUBS.idFromName(MAKIMA_OBJECT)).fetch(new Request('https://internal/internal/relay/makima/board-auth',{method:'POST',body:JSON.stringify(input)}));
 const data=await r.json();if(!r.ok||data.error)fail();return data;
}
export async function boardConnections(ctx,env){
 if(!boardEnabled(env))return [];
 const lucyIds=env.RELAY_AGENT_LUCY_OAUTH_ENABLED==='true'?grants(ctx,env,'lucy'):[];
 const digest=agentChatEnabled(env)?env.RELAY_AGENT_MUSE_TOKEN_SHA256:null;
 const lucy=await Promise.all(lucyIds.map(async id=>({agent:'lucy',connection_type:'lucy-oauth-grant',connection_id:await connectionId('lucy',id)})));
 const mast=digest?[{agent:'mast',connection_type:'mast-muse-profile',connection_id:await connectionId('mast-muse-profile',digest)}]:[];
 const makima=makimaEnabled(env)?(await remoteMakima(env,{op:'connections'})).connections:[];
 const verify=()=>{
  if(!boardEnabled(env))return [];
  return [...lucy.filter((c,i)=>env.RELAY_AGENT_LUCY_OAUTH_ENABLED==='true'&&relayGrantActiveInStore(ctx,env,lucyIds[i],RELAY_AGENT_SCOPE)),
    ...(agentChatEnabled(env)&&digest===env.RELAY_AGENT_MUSE_TOKEN_SHA256?mast:[]),...(makimaEnabled(env)?makima:[])];
 };
 const connections=verify();Object.defineProperty(connections,'verify',{value:verify});return connections;
}
export async function boardAgentStore(ctx,env,input){
 if(!boardEnabled(env))fail();
 let identity,validate;
 if(input.agent==='lucy'){
  identity={agent:'lucy',actor:'agent:lucy',connectionId:await connectionId('lucy',input.principal?.grantId||'')};
  validate=()=>{if(!boardEnabled(env)||env.RELAY_AGENT_LUCY_OAUTH_ENABLED!=='true'||!input.principal||!relayTokenActiveInStore(ctx,env,input.principal,RELAY_AGENT_SCOPE))fail();return identity;};
 }else if(input.agent==='mast'){
  identity={agent:'mast',actor:'agent:mast',connectionId:await connectionId('mast-muse-profile',input.token_hash||'')};
  validate=()=>{if(!boardEnabled(env)||!agentChatEnabled(env)||typeof input.token_hash!=='string'||!equal(input.token_hash,env.RELAY_AGENT_MUSE_TOKEN_SHA256))fail();return identity;};
 }else if(input.agent==='makima'){
  identity=await remoteMakima(env,{op:'validate',principal:input.principal});
  validate=()=>{if(!boardEnabled(env)||!makimaEnabled(env))fail();return identity;};
 }else fail();
 let result;
 if(input.op==='identity'){
  boardFields(input.args,[],[]);
  result=ctx.storage.transactionSync(()=>{
   const verified=validate();
   return {agent:verified.agent,connection_id:verified.connectionId,connection_type:{lucy:'lucy-oauth-grant',mast:'mast-muse-profile',makima:'makima-oauth-grant'}[verified.agent]};
  });
 }else result=boardStore(ctx,{op:input.op,args:input.args},validate);
 if(input.agent==='makima'){
  try{const checked=await remoteMakima(env,{op:'validate',principal:input.principal});if(checked.connectionId!==identity.connectionId)fail();}
  catch{throw new RelayError(-32012,'Original connection failed postvalidation; write outcome may be unknown. Do not blindly retry or execute work; reconcile the same operation ID after authorization is restored.',{status:403});}
 }
 return result;
}
export async function boardRemoteAgent(env,input){
 const response=await env.HUBS.get(env.HUBS.idFromName(RELAY_OAUTH_OBJECT)).fetch(new Request('https://internal/internal/relay/board/agent',{method:'POST',body:JSON.stringify(input)}));
 const data=await response.json();if(!response.ok||data.error)throw new RelayError(data.error?.code||-32012,data.error?.message||'Board unavailable');return data;
}
