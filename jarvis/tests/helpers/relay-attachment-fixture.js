import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {relayOwnerSchema,relayOwnerStore,relayOwnerRpc,relayOwnerPublic} from '../../backend/relay-owner.js';
import {relayOAuthStore} from '../../backend/relay-oauth.js';
import {relayRpc} from '../../backend/relay-connector.js';
import {RELAY_OWNER,RELAY_OWNER_INBOX,RELAY_CALLBACK,random,hash,challenge} from '../../backend/relay-common.js';
import {PRIMARY_SITE} from '../../backend/origins.js';
export const raster=JSON.parse(readFileSync(new URL('../fixtures/relay-attachment-raster.json',import.meta.url)));
export const id=()=>crypto.randomUUID();
export async function attachmentFixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let serial=0;
 const sql=(q,...values)=>db.prepare(q).all(...values.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v));
 const ctx={storage:{sql:{exec:sql},transactionSync(fn){
  const key='attachment_'+ ++serial;db.exec('SAVEPOINT '+key);
  try{const r=fn();assert.equal(r?.then,undefined);db.exec('RELEASE '+key);return r;}catch(e){db.exec('ROLLBACK TO '+key+'; RELEASE '+key);throw e;}
 }}};
 const env={RELAY_MCP_ENABLED:'true',RELAY_OWNER_ENABLED:'true',RELAY_MCP_ORIGIN:'https://relay.example.test'};
 const queued=[];const enqueue=(_ctx,entry)=>queued.push(structuredClone(entry));
 const store=(body,callback=enqueue)=>relayOwnerStore(ctx,env,body,callback);
 env.HUBS={idFromName:x=>x,get:()=>({fetch:request=>request.json().then(store)})};relayOwnerSchema(ctx);
 const client=random(),grantId=random(),code=random(),access=random(),refresh=random(),scope='relay:read relay:reply relay:events relay:owner',resource=env.RELAY_MCP_ORIGIN+'/relay/mcp';
 const registry=body=>relayOAuthStore(ctx,body).json();
 await registry({op:'put',key:'client:'+client,category:'client',value:{redirect:RELAY_CALLBACK},expiresAt:Date.now()+600000});
 const params={client_id:client,redirect_uri:RELAY_CALLBACK,code_challenge:await challenge(random()),scope};
 await registry({op:'authorize',grantId,codeKey:'code:'+await hash(code),params,resource});
 const accessHash=await hash(access);
 await registry({op:'exchange',key:'code:'+await hash(code),match:{client_id:client,redirect_uri:RELAY_CALLBACK,challenge:params.code_challenge,resource},accessKey:'access:'+accessHash,refreshKey:'refresh:'+await hash(refresh)});
 const principal={principal:RELAY_OWNER,grantId,scopes:scope.split(' '),accessHash};
 const rpc=(name,args,actor=principal)=>relayOwnerRpc(ctx,env,actor,name,args);
 const connector=(name,args,actor=principal)=>relayRpc(ctx,env,actor,{method:'tools/call',params:{name,arguments:args,_meta:{}}});
 const phone=async(name='Synthetic fixture phone')=>{
  const response=await store({op:'pair_start',label:name,rate_hash:await hash(random())});const pair=await response.json();
  const approved=await rpc('relay_owner_pairing_approve',{request_id:pair.request_id,code:pair.code,access_days:365,confirm:true});
  return {request_id:pair.request_id,device_id:approved.device.id,token:pair.device_token,token_hash:await hash(pair.device_token)};
 };
 const first=await phone();
 const upload=(message_id,options={},actor=first)=>store({op:'attachment_upload',token_hash:actor.token_hash,id:id(),message_id,name:'fixture.txt',mime_type:'text/plain',data_base64:Buffer.from('Synthetic untrusted file.').toString('base64'),...options});
 const send=(messageId,attachmentIds=[],body='Synthetic fixture request',actor=first,callback=enqueue)=>store({op:'message',token_hash:actor.token_hash,id:messageId,body,...(attachmentIds===undefined?{}:{attachment_ids:attachmentIds})},callback);
 const http=(path,{body,token=first.token,origin=PRIMARY_SITE,method=body===undefined?'GET':'POST',headers={}}={})=>{
  const h=new Headers(headers);if(origin!==null)h.set('Origin',origin);if(token!==null)h.set('Authorization','Bearer '+token);if(body!==undefined)h.set('Content-Type','application/json');
  return relayOwnerPublic(new Request(env.RELAY_MCP_ORIGIN+'/relay/owner'+path,{method,headers:h,...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}),env);
 };
 return {db,ctx,env,sql,store,queued,phone,first,upload,send,rpc,connector,http,principal,access,inbox:RELAY_OWNER_INBOX,registry};
}
export const output=async response=>({status:response.status,body:await response.json()});
export async function saved(response){assert.equal(response.status,201,JSON.stringify(await response.clone().json()));return(await response.json()).attachment;}
