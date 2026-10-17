import {attachmentFixture,id,raster} from './relay-attachment-fixture.js';
import {relayConnector,relayRpc} from '../../backend/relay-connector.js';
import {relayOAuthStore} from '../../backend/relay-oauth.js';
import {relayOwnerStore,relayOwnerAssistantAttachmentIngress} from '../../backend/relay-owner.js';
import {RELAY_VERSION,RelayError} from '../../backend/relay-common.js';
export {id,raster};
export async function assistantFixture(t){
 const s=await attachmentFixture(t);
 s.env.HUBS={idFromName:x=>x,get:()=>({fetch:async request=>{
  const body=await request.json(),path=new URL(request.url).pathname;
  if(path==='/internal/relay/oauth')return relayOAuthStore(s.ctx,body);
  if(path==='/internal/relay/owner')return relayOwnerStore(s.ctx,s.env,body);
  try{
   if(path==='/internal/relay/assistant-attachment-admit')return Response.json(relayOwnerAssistantAttachmentIngress(s.ctx,s.env,body.principal));
   return Response.json({result:await relayRpc(s.ctx,s.env,body.principal,body.rpc)});
  }catch(e){return Response.json({error:{code:e instanceof RelayError?e.code:-32603,message:e.message,...(e.data?{data:e.data}:{})}});}
 }})};
 const uploadArgs=(message_id,delivery_id,options={})=>({inbox_id:s.inbox,message_id,delivery_id,attachment_id:id(),name:'synthetic.txt',mime_type:'text/plain',data_base64:Buffer.from('Synthetic generated file.').toString('base64'),...options});
 const upload=async(message,delivery,options={})=>(await s.connector('relay_owner_attachment_upload',uploadArgs(message,delivery,options))).structuredContent;
 const commitArgs=(message_id,delivery_id,files,body='Synthetic private delivery')=>({inbox_id:s.inbox,message_id,delivery_id,body,attachment_ids:files.map(file=>typeof file==='string'?file:file.id)});
 const commit=async(message,delivery,files,body='Synthetic private delivery',kind='deliverable')=>(await s.connector(kind==='reply'?'relay_owner_reply_with_attachments':'relay_owner_deliverable_send',commitArgs(message,delivery,files,body))).structuredContent;
 const mcpRequest=(name,args,{token=s.access,headers={},body}={})=>new Request(s.env.RELAY_MCP_ORIGIN+'/relay/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream','Mcp-Method':'tools/call','Mcp-Name':name,'MCP-Protocol-Version':RELAY_VERSION,...headers},body:body??JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args,_meta:{'io.modelcontextprotocol/protocolVersion':RELAY_VERSION,'io.modelcontextprotocol/clientCapabilities':{}}}})});
 const mcp=(name,args,options)=>relayConnector(mcpRequest(name,args,options),s.env);
 return {...s,assistantUpload:upload,uploadArgs,commitArgs,commit,mcpRequest,mcp};
}
