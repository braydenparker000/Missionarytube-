import {handleEgress,egressPreflight} from '../api/shared/pinned-https.mjs';
// Common Web Request handler for real-Node serverless runtimes.
export async function relayWebHandler(request, {token = process.env.RELAY_WEBHOOK_EGRESS_TOKEN, webhookFetch} = {}) {
  // Authenticate before reading an untrusted stream. handleEgress validates the
  // same credential in constant time before any callback network connection.
  const denied=egressPreflight({method:request.method,authorization:request.headers.get('Authorization')},token);
  if(denied){
    return Response.json(denied.body,{status:denied.status,headers:{'Cache-Control':'no-store'}});
  }
  const chunks=[];let size=0;
  const reader=request.body?.getReader();
  if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>400000){await reader.cancel();return Response.json({error:'request_too_large'},{status:413});}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let rawBody;try{rawBody=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return Response.json({error:'invalid_request'},{status:400});}
  const result=await handleEgress({method:request.method,authorization:request.headers.get('Authorization'),rawBody},{token,webhookFetch});
  return Response.json(result.body,{status:result.status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
