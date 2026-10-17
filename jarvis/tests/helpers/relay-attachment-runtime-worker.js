// Local-only test harness. Synthetic pairing/OAuth; never deployed.
import worker,{Hub} from '../../backend/worker.js';
import {relayOwnerSchema,relayOwnerStore,relayOwnerRpc} from '../../backend/relay-owner.js';
import {relayOAuthStore} from '../../backend/relay-oauth.js';
import {relayRpc} from '../../backend/relay-connector.js';
import {RELAY_OWNER,RELAY_OAUTH_OBJECT,RELAY_CALLBACK,random,hash,challenge} from '../../backend/relay-common.js';
export class AttachmentRuntimeHub extends Hub {
 async fetch(request){
  const path=new URL(request.url).pathname;
  if(path==='/fixture/setup'){
   relayOwnerSchema(this.ctx);
   const client=random(),grantId=random(),code=random(),access=random(),refresh=random(),scope='relay:read relay:reply relay:events relay:owner',resource=this.env.RELAY_MCP_ORIGIN+'/relay/mcp';
   const registry=body=>relayOAuthStore(this.ctx,body).json();
   await registry({op:'put',key:'client:'+client,category:'client',value:{redirect:RELAY_CALLBACK},expiresAt:Date.now()+600000});
   const params={client_id:client,redirect_uri:RELAY_CALLBACK,code_challenge:await challenge(random()),scope};
   await registry({op:'authorize',grantId,codeKey:'code:'+await hash(code),params,resource});
   const accessHash=await hash(access);
   await registry({op:'exchange',key:'code:'+await hash(code),match:{client_id:client,redirect_uri:RELAY_CALLBACK,challenge:params.code_challenge,resource},accessKey:'access:'+accessHash,refreshKey:'refresh:'+await hash(refresh)});
   this.fixturePrincipal={principal:RELAY_OWNER,grantId,scopes:scope.split(' '),accessHash};
   const pair=await(await relayOwnerStore(this.ctx,this.env,{op:'pair_start',label:'Synthetic workerd phone',rate_hash:await hash(random())})).json();
   const approved=await relayOwnerRpc(this.ctx,this.env,this.fixturePrincipal,'relay_owner_pairing_approve',{request_id:pair.request_id,code:pair.code,access_days:365,confirm:true});
   return Response.json({token:pair.device_token,device_id:approved.device.id,access});
  }
  if(path==='/fixture/tool'){
   const body=await request.json();
   return Response.json(await relayRpc(this.ctx,this.env,this.fixturePrincipal,{method:'tools/call',params:{_meta:{},name:body.name,arguments:body.args}}));
  }
  return super.fetch(request);
 }
}
export default {fetch(request,env){
 const path=new URL(request.url).pathname;
 if(path.startsWith('/fixture/'))return env.HUBS.get(env.HUBS.idFromName(RELAY_OAUTH_OBJECT)).fetch(request);
 return worker.fetch(request,env);
}};
