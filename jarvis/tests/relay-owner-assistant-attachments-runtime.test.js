import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {PRIMARY_SITE} from '../backend/origins.js';
import {RELAY_VERSION} from '../backend/relay-common.js';
import {id,raster} from './helpers/relay-assistant-attachment-fixture.js';
test('assistant attachments: actual workerd public MCP OAuth/Worker/Hub stages, replies and later delivers exact private bytes',{timeout:60000},async()=>{
 const config=JSON.parse(readFileSync(new URL('../backend/wrangler.jsonc',import.meta.url),'utf8'));
 const bundle=await build({entryPoints:[fileURLToPath(new URL('./helpers/relay-attachment-runtime-worker.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:crypto']});
 const origin='https://assistant-attachment-runtime.example.test';let egress=0;
 const mf=new Miniflare(convertV4MiniflareOptions({name:'local-assistant-attachment-runtime',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags||[],cf:false,telemetry:{enabled:false},bindings:{RELAY_MCP_ENABLED:'true',RELAY_OWNER_ENABLED:'true',RELAY_MCP_ORIGIN:origin},durableObjects:{HUBS:{className:'AttachmentRuntimeHub',useSQLite:true}},outboundService(){egress++;throw Error('Synthetic private file delivery must not make external requests');}}));
 try{
  const setup=await(await mf.dispatchFetch(origin+'/fixture/setup')).json();
  const owner=(path,body,token=setup.token)=>mf.dispatchFetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:PRIMARY_SITE,...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const mcp=async(name,args)=>{
   const response=await mf.dispatchFetch(origin+'/relay/mcp',{method:'POST',headers:{Origin:'https://chatgpt.com',Authorization:'Bearer '+setup.access,'Content-Type':'application/json',Accept:'application/json, text/event-stream','Mcp-Method':'tools/call','Mcp-Name':name,'MCP-Protocol-Version':RELAY_VERSION},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args,_meta:{'io.modelcontextprotocol/protocolVersion':RELAY_VERSION,'io.modelcontextprotocol/clientCapabilities':{}}}})});
   assert.equal(response.status,200);const data=await response.json();assert.equal(data.error,undefined,JSON.stringify(data));return data.result;
  };
  const message=id();assert.equal((await owner('/relay/owner/messages',{id:message,body:'Synthetic private requested files'})).status,201);
  const pdf=JSON.parse(readFileSync(new URL('./fixtures/relay-attachment-document.json',import.meta.url))).pdf;
  const files=[{name:'synthetic.png',mime_type:'image/png',data_base64:raster.png,kind:'reply'},{name:'synthetic.pdf',mime_type:'application/pdf',data_base64:pdf,kind:'deliverable'},{name:'maximum-synthetic.txt',mime_type:'text/plain',data_base64:Buffer.alloc(1048576,65).toString('base64'),kind:'deliverable'}];
  let acceptedReply;
  for(const input of files){
   const delivery=id(),attachment=id(),{kind,...file}=input,args={inbox_id:'brayden-owner',message_id:message,delivery_id:delivery,attachment_id:attachment,...file},bytes=Buffer.from(file.data_base64,'base64'),sha=createHash('sha256').update(bytes).digest('hex');
   const uploaded=await mcp('relay_owner_attachment_upload',args);assert.equal(uploaded.structuredContent.attachment.sha256,sha);
   assert.equal(uploaded.structuredContent.attachment.messageId,message);assert.equal(JSON.stringify(uploaded.structuredContent).includes(file.data_base64),false);
   const commit={inbox_id:'brayden-owner',message_id:message,delivery_id:delivery,body:kind==='reply'?'':'Synthetic later file',attachment_ids:[attachment]};
   const tool=kind==='reply'?'relay_owner_reply_with_attachments':'relay_owner_deliverable_send',saved=await mcp(tool,commit);
   assert.equal(saved.structuredContent.newWrite,true);assert.equal(saved.structuredContent.delivery.id,delivery);
   assert.equal((await mcp(tool,commit)).structuredContent.newWrite,false);
   const route='/relay/owner/attachments/content?message_id='+message+'&attachment_id='+attachment;
   const download=await owner(route);assert.equal(download.status,200);assert.equal(download.headers.get('Cache-Control'),'no-store');assert.equal(download.headers.get('X-Content-Type-Options'),'nosniff');
   const returned=Buffer.from(await download.arrayBuffer());assert.deepEqual(returned,bytes);assert.equal(createHash('sha256').update(returned).digest('hex'),sha);
   assert.equal((await owner(route,undefined,null)).status,401);assert.equal((await owner(route.replace(message,id()))).status,404);
   const native=await mcp('relay_owner_attachment_read',{inbox_id:'brayden-owner',message_id:message,attachment_id:attachment});
   if(kind==='reply'){
    acceptedReply=delivery;assert.equal(native.content.find(x=>x.type==='image').data,file.data_base64);
    const preview=await owner(route+'&preview=1');assert.equal(preview.status,200);assert.match(preview.headers.get('Content-Disposition'),/^inline;/);
   }else if(file.mime_type==='application/pdf'){
    assert.equal(native.content.find(x=>x.type==='resource').resource.blob,file.data_base64);assert.equal((await owner(route+'&preview=1')).status,415);
   }else assert.equal(native.content[1].text.includes('A'.repeat(1048576)),true);
  }
  const conversation=await(await owner('/relay/owner/conversation?message_id='+message)).json();
  assert.equal(conversation.reply.id,acceptedReply);assert.equal(conversation.reply.body,'');assert.equal(conversation.reply.attachments[0].name,'synthetic.png');
  assert.equal(conversation.message.attachments,undefined);assert.equal(conversation.deliverables.length,2);assert.equal(conversation.deliverablesNextCursor,null);
  const page=await mcp('relay_owner_deliverables_list',{inbox_id:'brayden-owner',message_id:message});assert.equal(page.structuredContent.deliverables.length,2);
  const job=await mcp('relay_owner_job_read',{inbox_id:'brayden-owner',job_id:message});assert.equal(job.structuredContent.job.result.replyId,acceptedReply);assert.equal(job.structuredContent.job.completion,null);
  assert.equal((await owner('/relay/owner/devices/revoke',{device_id:setup.device_id})).status,200);
  assert.equal((await owner('/relay/owner/conversation?message_id='+message)).status,401);
  assert.equal(egress,0);
 }finally{await mf.dispose();}
});
