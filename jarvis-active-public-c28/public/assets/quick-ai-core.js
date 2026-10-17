import {MODELS,directReply} from './quick-ai-providers.js';
export {MODELS};
export const STORAGE_KEY='jarvis.quick-ai.v1';
export function parseHistory(raw){
  if(!raw)return {version:1,active:null,chats:[]};
  const state=JSON.parse(raw);
  if(state.version!==1||!Array.isArray(state.chats)||state.chats.length>50)throw Error('Invalid saved chats');
  for(const c of state.chats){
    if(typeof c.id!=='string'||typeof c.title!=='string'||typeof c.draft!=='string'||!Array.isArray(c.messages))throw Error('Invalid saved chat');
    if(!MODELS[c.provider])c.provider='gemini';
    if(typeof c.search!=='boolean')c.search=false;
    for(const m of c.messages){if(!['user','assistant'].includes(m.role)||typeof m.content!=='string')throw Error('Invalid saved message');if(m.role==='assistant'&&m.status!=='complete')m.status='interrupted';if(!Array.isArray(m.attachments))m.attachments=[];}
  }
  return state;
}
export function selectedMessages(messages){
  const turns=[];
  for(const m of messages){if(m.role==='user')turns.push([m]);else if(m.role==='assistant'&&m.status==='complete'&&turns.length)turns.at(-1).push(m);}
  const kept=[];let cost=0,omitted=0;
  for(const turn of turns.reverse()){
    const n=turn.reduce((sum,m)=>sum+Math.ceil(m.content.length/3)+(m.attachments?.length||0)*2048,0);
    if(cost+n>12000&&kept.length){omitted++;continue;}
    kept.unshift(...turn);cost+=n;
  }
  if(kept.at(-1)?.role!=='user')throw Error('No question to send');
  return {messages:kept,omitted};
}
export function chatUsage(messages){
  const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
  const replies=messages.filter(m=>m.role==='assistant'&&m.status==='complete');
  return {replies:replies.length,reported:replies.filter(m=>m.usage).length,input:replies.reduce((n,m)=>n+count(m.usage?.input),0),output:replies.reduce((n,m)=>n+count(m.usage?.output),0),credits:messages.reduce((n,m)=>n+(m.role==='user'?count(m.searchCredits):0),0)};
}
export async function streamReply({keys,provider,messages,search=false,query='',retry=false,signal,onEvent=()=>{},fetcher=fetch}){
  const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(),120000);
  const combined=signal?AbortSignal.any([signal,timeout.signal]):timeout.signal;
  let res;
  try{res=await directReply({keys,provider,messages,search,query,retry,signal:combined,fetcher,onSearchUsage:data=>onEvent('searchUsage',data,'')});}
  catch(error){clearTimeout(timer);if(timeout.signal.aborted){const e=new Error('Provider timed out. Tap Retry.');e.code='timeout';throw e;}throw error;}
  if(!res.body)throw Error('Streaming unavailable');
  const reader=res.body.getReader(),decoder=new TextDecoder();let buffer='',content='',complete=false,meta=null;
  const consume=block=>{
    let type='message';const lines=block.split('\n');for(const line of lines)if(line.startsWith('event:'))type=line.slice(6).trim();
    const raw=lines.filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!raw)return;
    const data=JSON.parse(raw);if(type==='error'){const e=new Error(data.message);e.code=data.code;throw e;}
    if(type==='metadata')meta=data;
    if(type==='text')content+=data.text;
    if(type==='complete')complete=true;
    onEvent(type,data,content);
  };
  try{
    while(true){const next=await reader.read();buffer+=decoder.decode(next.value,{stream:!next.done});buffer=buffer.replace(/\r\n/g,'\n');let end;while((end=buffer.indexOf('\n\n'))>=0){consume(buffer.slice(0,end));buffer=buffer.slice(end+2);}if(next.done){if(buffer.trim())consume(buffer);break;}}
    if(!complete)throw Error('Connection ended before the reply completed. Tap Retry.');
    if(!content)throw Error('Provider returned no answer. Tap Retry.');
    return {content,meta};
  }finally{clearTimeout(timer);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
const DB='jarvis.quick-ai.attachments';
export function imageDB(){
  const open=()=>new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>req.result.createObjectStore('images');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  const transaction=async (mode,fn)=>{const db=await open();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('images',mode),s=tx.objectStore('images');let value;const req=fn(s);req.onsuccess=()=>{value=req.result;};req.onerror=()=>reject(req.error);tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error||Error('Image storage failed'));tx.onerror=()=>reject(tx.error);});}finally{db.close();}};
  return {put:(id,blob)=>transaction('readwrite',s=>s.put(blob,id)),get:id=>transaction('readonly',s=>s.get(id)),delete:id=>transaction('readwrite',s=>s.delete(id))};
}
export async function prepareImage(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Choose a JPEG, PNG, or WebP image.');
  if(file.size>12_000_000)throw Error('Image exceeds the 12 MB import limit.');
  let bitmap;try{bitmap=await createImageBitmap(file);}catch{throw Error('The image could not be decoded.');}
  try{
    if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>30_000_000)throw Error('Image dimensions are unsupported.');
    const scale=Math.min(1,2048/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    let quality=.88,blob;
    do{blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));quality-=.1;}while(blob?.size>2_000_000&&quality>.48);
    if(!blob||blob.size>2_000_000)throw Error('Image is too detailed to send under the 2 MB limit.');
    return blob;
  }finally{bitmap.close();}
}
export async function blobData(blob){
  const raw=await blob.arrayBuffer();const bytes=new Uint8Array(raw);let str='';for(let i=0;i<bytes.length;i+=8192)str+=String.fromCharCode(...bytes.subarray(i,i+8192));return {mime:blob.type,data:btoa(str)};
}
export function cleanURL(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
